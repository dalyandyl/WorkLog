import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { getStorageRoot, migrateStorageRoot } from './storage'
import { cancelUpdateDownload, checkForUpdates, downloadUpdate, initUpdater, installUpdate, setUpdateSource } from './updater'
import { readSettings, writeSettings } from './meta'
import { setDataWarningHandler, type DataWarning } from './jsonStore'
import type { AppSettings, ReminderSetting, UpdateSource, WebdavConfig } from '../shared/types'
import {
  createTask,
  datesOfTask,
  deleteTask,
  listDatesWithTasks,
  postponeTask,
  publishTasks,
  readTasks,
  readTasksMany,
  reorderTasks,
  resetTaskCache,
  restoreTasksToDays,
  updateTask,
  type NewTaskInput,
  type Task
} from './tasks'
import { createTag, deleteTag, listTags, recolorTag, renameTag } from './tags'
import {
  clearTrash,
  findTrashItem,
  listTrash,
  removeTrashItem,
  snapshotPublishRecordToTrash,
  snapshotTaskToTrash
} from './trash'
import {
  getWeekInfoByKey,
  readWeeklySummary,
  shiftWeekKey,
  writeWeeklySummary
} from './weekly'
import { searchTasks } from './search'
import { rangeStats } from './stats'
import { lastDataMtime, webdavPull, webdavPush } from './sync'
import { addPublishRecord, deletePublishRecord, readPublishRecords } from './history'
import { buildDayMarkdown, buildRangeMarkdown, buildWeekMarkdown } from './exporter'
import { exportBackup, importBackup } from './backup'
import { migrateLegacyData, resetMigration } from './migrate'
import { applyReminder, createTray } from './tray'
import {
  attachmentUrlToPath,
  deleteAttachmentFile,
  importAttachmentFile,
  saveAttachmentBuffer
} from './attachments'
import type { Meeting, StickyNote } from '../shared/types'
import { listMeetings, saveMeeting, deleteMeeting } from './meetings'
import { meetingToMarkdown, meetingExportFileName } from './meetingExport'
import {
  addStickyNote,
  deleteStickyNote,
  listStickyNotes,
  updateStickyNote
} from './stickyNotes'

// 注：commandLine.appendSwitch 已移至 app.whenReady() 内部执行，
// 因为在 electron-vite dev 模式下模块顶层的 app/protocol 对象尚未初始化。

// 自定义协议：用于在界面中显示/打开本地附件，须在 app ready 前注册
// （在 electron-vite dev 模式下 protocol 可能为 undefined，需要条件调用）
if (typeof protocol !== 'undefined') {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'wlattach',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

let isQuitting = false

function broadcastUpdate(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update:event', { channel, payload })
  }
}

/**
 * 数据层告警（文件损坏被隔离、写盘失败、回收站超限等）。
 *
 * 启动阶段（迁移旧数据）窗口还没建好，此时直接 send 会丢失，
 * 因此先缓冲，等渲染层加载完成后再补发 —— 不能把启动期的数据问题吞掉。
 */
const pendingDataWarnings: DataWarning[] = []

function broadcastDataWarning(w: DataWarning): void {
  const wins = BrowserWindow.getAllWindows()
  if (wins.length === 0) {
    pendingDataWarnings.push(w)
    return
  }
  for (const win of wins) {
    win.webContents.send('data:warning', w)
  }
}

function flushDataWarnings(webContents: Electron.WebContents): void {
  for (const w of pendingDataWarnings.splice(0)) {
    webContents.send('data:warning', w)
  }
}

/**
 * 内存中的当前设置缓存。
 * `before-quit` 需要在**同步**阶段决定是否阻止退出，不能在里面 await 读盘，
 * 因此设置变化时同步维护这份缓存。
 */
let cachedSettings: AppSettings | null = null

/** WebDAV 自动同步的排程相关字段是否变化（变了才需要重建定时器） */
function webdavScheduleChanged(a: WebdavConfig, b: WebdavConfig): boolean {
  return (
    a.enabled !== b.enabled ||
    a.autoMode !== b.autoMode ||
    a.intervalMinutes !== b.intervalMinutes ||
    a.url !== b.url ||
    a.username !== b.username
  )
}

/** 每日提醒的时间/开关是否变化 */
function reminderChanged(a: ReminderSetting, b: ReminderSetting): boolean {
  return a.enabled !== b.enabled || a.time !== b.time
}

interface SaveResult {
  ok: boolean
  canceled?: boolean
  path?: string
  error?: string
}

/**
 * 「弹保存对话框 → 写入」的统一封装。
 *
 * 改造前这段逻辑在 `index.ts` 里逐字重复了 5 次
 * （`meetings:export` / `export:md` / `backup:export` / `report:exportMd` / `report:exportWord`），
 * 每处都各自处理 canceled / try-catch / 焦点窗口。见 memory-bank/07-optimization-backlog.md P2-4。
 */
async function saveWithDialog(
  title: string,
  defaultPath: string,
  filters: Electron.FileFilter[],
  save: (filePath: string) => Promise<void>
): Promise<SaveResult> {
  try {
    const options: Electron.SaveDialogOptions = { title, defaultPath, filters }
    const win = BrowserWindow.getFocusedWindow()
    const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    await save(res.filePath)
    return { ok: true, path: res.filePath }
  } catch (err) {
    console.error(`${title} failed:`, err)
    return { ok: false, error: String(err) }
  }
}

function appIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'build', 'icon.png')
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: '日志工具',
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      disableBlinkFeatures: 'CaretLineHighlight'
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 渲染层加载完成后补发启动期缓冲的数据层告警
  mainWindow.webContents.on('did-finish-load', () => {
    flushDataWarnings(mainWindow.webContents)
  })

  // 彻底移除窗口菜单栏：autoHideMenuBar 只是“隐藏”，按 Alt 仍会弹出默认的
  // File/Edit/View/Window 菜单；只有真正移除菜单才能禁用这一行为。
  mainWindow.removeMenu()

  // 关闭窗口 = 最小化到托盘，保持提醒可用；真正退出走托盘菜单
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  } else {
    createWindow()
  }
}

// 注意：勿再调用 app.disableHardwareAcceleration() 做内存优化——
// 禁用 GPU 后界面退回软件渲染（SwiftShader），弹窗遮罩 blur / 阴影 / 动画全部卡顿。
// 如需压内存，请从渲染层入手（懒加载已做），不要牺牲硬件加速。
// 单实例锁：桌面再次双击 exe 或重复运行时，只聚焦已有窗口，不启动第二个进程
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showWindow()
  })
}

interface ExportOptions {
  mode: 'day' | 'week' | 'range'
  date?: string
  weekKey?: string
  start?: string
  end?: string
}

app.whenReady().then(async () => {
  if (!gotTheLock) return // 第二个实例：已在上面请求退出，不再初始化任何东西

  app.setAppUserModelId('com.worklog.app')

  // 数据层告警出口（须早于任何读写数据的调用，例如下面的迁移）
  setDataWarningHandler(broadcastDataWarning)

  // 移除 Electron 默认应用菜单（File/Edit/View/Window），避免任何窗口被自动赋予菜单
  Menu.setApplicationMenu(null)

  // 关闭 Chromium 光标所在行的高亮（编辑器中出现黄框高亮一行的问题）
  // 禁用 GPU 着色器磁盘缓存与 HTTP 磁盘缓存：避免缓存目录无法移动/创建时报错
  app.commandLine.appendSwitch('disable-features', 'CaretLineHighlight')
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
  app.commandLine.appendSwitch('disk-cache-size', '0')

  // 日志存储根目录：打包后 = %APPDATA%/WorkLog/logs（持久目录）；开发中 = 项目目录/logs
  const storageRoot = getStorageRoot()

  // 打包版首次启动：把更新前备份 / 旧安装目录里的 logs 迁移到持久目录（防止更新清空数据）
  await migrateStorageRoot()

  // 一次性迁移旧版本数据（旧标签/周报/发布记录/日报直建任务）
  await migrateLegacyData(storageRoot)

  // 服务附件：wlattach://attachments/<folder>/<file> -> 磁盘文件
  protocol.handle('wlattach', (request) => {
    const filePath = attachmentUrlToPath(storageRoot, request.url)
    if (!filePath) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(filePath).toString())
  })

  // ---- 任务 ----
  ipcMain.handle('storage:root', () => storageRoot)
  ipcMain.handle('tasks:read', (_event, date: string) => readTasks(storageRoot, date))
  ipcMain.handle('tasks:readMany', (_event, dates: string[]) =>
    readTasksMany(storageRoot, dates)
  )
  ipcMain.handle('tasks:listDates', () => listDatesWithTasks(storageRoot))
  ipcMain.handle('tasks:create', (_event, date: string, input: NewTaskInput) =>
    createTask(storageRoot, date, input)
  )
  ipcMain.handle(
    'tasks:update',
    (_event, date: string, taskId: string, patch: Partial<Task>) =>
      updateTask(storageRoot, date, taskId, patch)
  )
  ipcMain.handle('tasks:delete', (_event, date: string, taskId: string) =>
    deleteTask(storageRoot, date, taskId)
  )
  // ---- 删除单个已发布任务：进回收站（含区间共享任务的所有日期） ----
  ipcMain.handle('tasks:trash', async (_event, date: string, taskId: string) => {
    const snap = await snapshotTaskToTrash(storageRoot, taskId)
    if (!snap.ok) return { ok: false }
    await deleteTask(storageRoot, date, taskId)
    return { ok: true }
  })
  ipcMain.handle('tasks:reorder', (_event, date: string, orderedIds: string[]) =>
    reorderTasks(storageRoot, date, orderedIds)
  )
  // 查询任务当前出现的所有日期（延期弹窗展示原区间、计算默认长度）
  ipcMain.handle('tasks:datesOf', (_event, taskId: string) =>
    datesOfTask(storageRoot, taskId)
  )
  // 任务延期：在原区间基础上追加自定义新区间（共享 id，全区间同步）
  ipcMain.handle(
    'tasks:postpone',
    (_event, date: string, taskId: string, newDates: string[]) =>
      postponeTask(storageRoot, date, taskId, newDates)
  )
  ipcMain.handle(
    'tasks:publish',
    async (_event, dates: string[], input: NewTaskInput) => {
      const r = await publishTasks(storageRoot, dates, input)
      // 记录发布历史（含实例定位，用于整批回收）
      await addPublishRecord(storageRoot, {
        id: crypto.randomUUID(),
        title: input.title.trim() || '未命名任务',
        tags: [...input.tags],
        dates: [...dates],
        body: input.body,
        subtasks: input.subtasks ?? [],
        publishedAt: new Date().toISOString(),
        instances: r.instances
      })
      return r
    }
  )

  // ---- 标签库 ----
  ipcMain.handle('tags:list', () => listTags(storageRoot))
  ipcMain.handle('tags:create', (_event, name: string, color: string) =>
    createTag(storageRoot, name, color)
  )
  ipcMain.handle('tags:rename', (_event, id: string, name: string) =>
    renameTag(storageRoot, id, name)
  )
  ipcMain.handle('tags:recolor', (_event, id: string, color: string) =>
    recolorTag(storageRoot, id, color)
  )
  ipcMain.handle('tags:delete', (_event, id: string) => deleteTag(storageRoot, id))

  // ---- 回收站 ----
  ipcMain.handle('trash:list', () => listTrash(storageRoot))
  ipcMain.handle('trash:clear', async () => {
    await clearTrash(storageRoot)
    return { ok: true }
  })
  ipcMain.handle('trash:remove', (_event, id: string) => removeTrashItem(storageRoot, id))
  ipcMain.handle('trash:restore', async (_event, id: string) => {
    // 先重放成功再移出回收站：旧实现「取出即移除」会在重放失败时永久丢失条目
    const item = await findTrashItem(storageRoot, id)
    if (!item) return { ok: false }
    await restoreTasksToDays(
      storageRoot,
      item.tasks.map((t) => ({ date: t.date, task: t.task }))
    )
    await removeTrashItem(storageRoot, id)
    return { ok: true }
  })

  // ---- 删除发布历史：整批任务进回收站 ----
  ipcMain.handle('history:trash', async (_event, id: string) => {
    const records = await readPublishRecords(storageRoot)
    const rec = records.find((r) => r.id === id)
    if (!rec) return { ok: false }
    // 区间共享任务同一 id 跨多天：快照组装下沉到 trash.ts（先快照、后删除）
    const snap = await snapshotPublishRecordToTrash(storageRoot, rec)
    for (const taskId of snap.taskIds) {
      // deleteTask 忽略传入的 date（它自己按 id 扫描所有包含该 id 的日期）
      await deleteTask(storageRoot, '', taskId)
    }
    await deletePublishRecord(storageRoot, id)
    return { ok: true }
  })

  // ---- 周报 ----
  ipcMain.handle('weekly:info', (_event, weekKey: string) => getWeekInfoByKey(weekKey))
  ipcMain.handle('weekly:read', (_event, weekKey: string) =>
    readWeeklySummary(storageRoot, weekKey)
  )
  ipcMain.handle(
    'weekly:write',
    (_event, weekKey: string, summary: string) =>
      writeWeeklySummary(storageRoot, weekKey, summary)
  )
  ipcMain.handle('weekly:shift', (_event, weekKey: string, delta: number) =>
    shiftWeekKey(weekKey, delta)
  )

  // ---- 设置 ----
  ipcMain.handle('settings:get', () => readSettings(storageRoot))
  ipcMain.handle('settings:set', async (_event, s) => {
    // 先读旧设置，用于判断哪些"运行时排程"需要重排
    const prev = await readSettings(storageRoot)
    await writeSettings(storageRoot, s)
    cachedSettings = s
    // 设置变化时同步应用更新镜像源（如设置页切换了镜像源）
    if (s && typeof s.updateSource === 'string') setUpdateSource(s.updateSource)
    // WebDAV 自动同步与每日提醒都是常驻定时器：相关字段变化时必须重排，
    // 否则改了间隔 / 开关需要重启应用才生效（旧实现的缺陷）
    if (s?.webdav && webdavScheduleChanged(prev.webdav, s.webdav)) {
      await applyAutoSync()
    }
    if (s?.reminder && reminderChanged(prev.reminder, s.reminder)) {
      applyReminder(s.reminder.enabled, s.reminder.time)
    }
  })

  // ---- 搜索 / 统计 ----
  ipcMain.handle('search:tasks', (_event, query: string) =>
    searchTasks(storageRoot, query)
  )
  ipcMain.handle('stats:range', (_event, start: string, end: string) =>
    rangeStats(storageRoot, start, end)
  )

  // ---- 发布历史 ----
  ipcMain.handle('history:list', () => readPublishRecords(storageRoot))
  ipcMain.handle('history:delete', (_event, id: string) =>
    deletePublishRecord(storageRoot, id)
  )

  // ---- 法定节假日（按年拉取，timor.tech 官方数据） ----
  ipcMain.handle('holiday:fetch', async (_event, year: number) => {
    try {
      const res = await net.fetch(`https://timor.tech/api/holiday/year/${year}`)
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const json = (await res.json()) as {
        code?: number
        holiday?: Record<string, { holiday: boolean; name: string; date: string }>
      }
      if (json?.code !== 0) return { ok: false, error: '接口返回异常' }
      const holiday: Record<string, string> = {}
      const workday: Record<string, string> = {}
      for (const [mmdd, item] of Object.entries(json.holiday ?? {})) {
        const date = item.date || `${year}-${mmdd}`
        if (item.holiday) holiday[date] = item.name
        else workday[date] = item.name
      }
      return { ok: true, holiday, workday }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // ---- 附件 ----
  ipcMain.handle(
    'attach:saveImage',
    (_event, folder: string, name: string, buf: ArrayBuffer) =>
      saveAttachmentBuffer(storageRoot, folder, name, buf)
  )
  ipcMain.handle('attach:pickFile', async (_event, folder: string) => {
    try {
      const options: Electron.OpenDialogOptions = {
        title: '选择附件',
        properties: ['openFile', 'multiSelections']
      }
      const win = BrowserWindow.getFocusedWindow()
      const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true }
      const files: { url: string; name: string }[] = []
      for (const srcPath of res.filePaths) {
        const { url } = await importAttachmentFile(storageRoot, folder, srcPath)
        files.push({ url, name: path.basename(srcPath) })
      }
      return { ok: true, files }
    } catch (err) {
      console.error('attach:pickFile failed:', err)
      return { ok: false, error: String(err) }
    }
  })
  ipcMain.handle('attach:open', async (_event, url: string) => {
    const filePath = attachmentUrlToPath(storageRoot, url)
    if (!filePath) return { ok: false, error: '附件路径无效' }
    const err = await shell.openPath(filePath)
    return err ? { ok: false, error: err } : { ok: true }
  })
  ipcMain.handle('attach:delete', async (_event, url: string) => {
    const ok = await deleteAttachmentFile(storageRoot, url)
    return ok ? { ok: true } : { ok: false, error: '附件路径无效或删除失败' }
  })

  // ---- 会议纪要 ----
  ipcMain.handle('meetings:list', () => listMeetings(storageRoot))
  ipcMain.handle(
    'meetings:save',
    async (_event, meeting: Meeting) => {
      await saveMeeting(storageRoot, meeting)
      return { ok: true }
    }
  )
  ipcMain.handle('meetings:delete', (_event, id: string) => deleteMeeting(storageRoot, id))

  // ---- 便签 ----
  ipcMain.handle('sticky:list', () => listStickyNotes(storageRoot))
  ipcMain.handle('sticky:add', (_event, text: string) => addStickyNote(storageRoot, text))
  ipcMain.handle(
    'sticky:update',
    (_event, id: string, patch: Partial<Pick<StickyNote, 'text' | 'pinned' | 'completed'>>) =>
      updateStickyNote(storageRoot, id, patch)
  )
  ipcMain.handle('sticky:delete', (_event, id: string) => deleteStickyNote(storageRoot, id))

  // 单篇导出 Markdown（元信息头 + 正文转换 + 附件清单）
  ipcMain.handle('meetings:export', async (_event, meeting: Meeting) => {
    try {
      const tags = await listTags(storageRoot)
      const tagNames = (meeting.tags ?? [])
        .map((id) => tags.find((t) => t.id === id)?.name)
        .filter((n): n is string => Boolean(n))
      const md = meetingToMarkdown(meeting, tagNames)
      return await saveWithDialog(
        '导出会议纪要',
        meetingExportFileName(meeting),
        [{ name: 'Markdown', extensions: ['md'] }],
        (filePath) => fs.writeFile(filePath, md, 'utf-8')
      )
    } catch (err) {
      console.error('meetings:export failed:', err)
      return { ok: false, error: String(err) }
    }
  })

  // ---- 导出 Markdown ----
  ipcMain.handle('export:md', async (_event, opts: ExportOptions) => {
    try {
      let content = ''
      let defaultName = '日志.md'

      if (opts.mode === 'day' && opts.date) {
        content = await buildDayMarkdown(storageRoot, opts.date)
        defaultName = `${opts.date}.md`
      } else if (opts.mode === 'week' && opts.weekKey) {
        content = await buildWeekMarkdown(storageRoot, opts.weekKey)
        defaultName = `周报-${opts.weekKey}.md`
      } else if (opts.mode === 'range' && opts.start && opts.end) {
        content = await buildRangeMarkdown(storageRoot, opts.start, opts.end)
        defaultName = `日志-${opts.start}_${opts.end}.md`
      } else {
        return { ok: false, error: '导出参数不完整' }
      }

      return await saveWithDialog(
        '导出 Markdown',
        defaultName,
        [{ name: 'Markdown', extensions: ['md'] }],
        (filePath) => fs.writeFile(filePath, content, 'utf-8')
      )
    } catch (err) {
      console.error('export:md failed:', err)
      return { ok: false, error: String(err) }
    }
  })

  // ---- 备份 ----
  ipcMain.handle('backup:export', async () => {
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    return saveWithDialog(
      '导出备份',
      `日志工具备份-${stamp}.zip`,
      [{ name: 'Zip 压缩包', extensions: ['zip'] }],
      (filePath) => exportBackup(storageRoot, filePath)
    )
  })

  ipcMain.handle('backup:import', async () => {
    try {
      const options: Electron.OpenDialogOptions = {
        title: '导入备份',
        filters: [{ name: 'Zip 压缩包', extensions: ['zip'] }],
        properties: ['openFile']
      }
      const win = BrowserWindow.getFocusedWindow()
      const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true }
      await importBackup(storageRoot, res.filePaths[0])
      await resetMigration(storageRoot) // 导入旧备份后重新执行迁移
      resetTaskCache() // 磁盘内容被整体替换：丢弃天文件缓存与任务索引
      return { ok: true }
    } catch (err) {
      console.error('backup:import failed:', err)
      return { ok: false, error: String(err) }
    }
  })

  createTray(showWindow)
  createWindow()

  // ---- 自动更新（Gitee / GitHub 双通道，运行时经 API 校验令牌与仓库配置） ----
  initUpdater(broadcastUpdate)
  // 应用设置里保存的更新镜像源（auto / gitee / github）
  const initSettings = await readSettings(storageRoot)
  cachedSettings = initSettings
  setUpdateSource(initSettings.updateSource)
  // 每日提醒：按目标时刻精确排程（不再 30 秒轮询读盘）
  applyReminder(initSettings.reminder.enabled, initSettings.reminder.time)
  ipcMain.handle('app:getInfo', () => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged
  }))
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:download', () => downloadUpdate())
  ipcMain.handle('update:cancel', () => cancelUpdateDownload())
  ipcMain.handle('update:install', () => installUpdate())
  ipcMain.handle('update:set-source', (_event, source: UpdateSource) => {
    setUpdateSource(source)
    return { ok: true }
  })

  // ---- WebDAV 跨设备同步 ----
  /** 拉取前自动备份本地数据（保留最近 3 份），放在数据根目录之外避免被再次打包上传 */
  async function backupBeforePull(): Promise<void> {
    try {
      const dir = path.join(app.getPath('userData'), 'pre-pull-backup')
      await fs.mkdir(dir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await exportBackup(storageRoot, path.join(dir, `logs-${stamp}.zip`))
      // 只保留最近 3 份
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.zip')).sort()
      for (const f of files.slice(0, Math.max(0, files.length - 3))) {
        await fs.rm(path.join(dir, f), { force: true })
      }
    } catch (err) {
      // 备份失败不应阻断同步，只记录
      console.error('拉取前自动备份失败:', err)
    }
  }

  async function syncWithResult(which: 'push' | 'pull'): Promise<{ ok: boolean; error?: string }> {
    const s = await readSettings(storageRoot)
    if (!s.webdav.url || !s.webdav.username) {
      return { ok: false, error: '请先在设置中配置 WebDAV（地址 / 账号 / 密码）' }
    }
    // 拉取是「解压合并覆盖」，可能盖掉本地较新的文件且没有版本比较：
    // 先自动留一份本地快照，用户随时可以回退
    if (which === 'pull') await backupBeforePull()
    const r = which === 'push' ? await webdavPush(storageRoot, s.webdav) : await webdavPull(storageRoot, s.webdav)
    if (r.ok) {
      // 拉取会整体覆盖本地文件：必须丢弃天文件缓存与任务索引
      if (which === 'pull') resetTaskCache()
      s.webdav.lastSyncAt = new Date().toISOString()
      await writeSettings(storageRoot, s)
      cachedSettings = s
    }
    return r
  }
  ipcMain.handle('sync:push', () => syncWithResult('push'))
  ipcMain.handle('sync:pull', () => syncWithResult('pull'))
  ipcMain.handle('sync:localMtime', async () => ({ ok: true, mtime: await lastDataMtime(storageRoot) }))

  // 自动同步：启动时拉取 / 定时上传。
  // 定时器由 applyAutoSync 统一管理，settings:set 中相关字段变化时会重排，
  // 因此改间隔 / 改开关不再需要重启应用。
  let autoSyncTimer: NodeJS.Timeout | null = null

  async function applyAutoSync(): Promise<void> {
    if (autoSyncTimer) {
      clearInterval(autoSyncTimer)
      autoSyncTimer = null
    }
    const s = await readSettings(storageRoot)
    if (!s.webdav.enabled || !s.webdav.url || !s.webdav.username) return
    if (s.webdav.autoMode === 'startup') {
      await syncWithResult('pull')
      return
    }
    if (s.webdav.autoMode === 'interval') {
      const minutes = Math.max(5, s.webdav.intervalMinutes || 30)
      autoSyncTimer = setInterval(() => {
        void syncWithResult('push')
      }, minutes * 60 * 1000)
    }
  }
  void applyAutoSync()

  // 退出时自动上传（仅一次）。
  // 注意：必须**同步**判断并 preventDefault —— 若先 await 读盘再 preventDefault，
  // 异步间隙里 quit 流程已经继续，上传会被跳过（旧实现的丢同步窗口）。
  let exitPushed = false
  app.on('before-quit', (e) => {
    if (exitPushed) return
    const s = cachedSettings
    if (!s || !s.webdav.enabled || s.webdav.autoMode !== 'exit') return
    if (!s.webdav.url || !s.webdav.username) return
    exitPushed = true
    e.preventDefault()
    void (async () => {
      await syncWithResult('push')
      app.quit()
    })()
  })

  // ---- 报表导出（MD / Word） ----
  ipcMain.handle('report:exportMd', (_event, md: string, defaultName: string) =>
    saveWithDialog(
      '导出报表',
      `${defaultName}.md`,
      [{ name: 'Markdown 文件', extensions: ['md'] }],
      (filePath) => fs.writeFile(filePath, md, 'utf-8')
    )
  )

  // Word 导出：以 HTML 内容保存为 .doc（Word/WPS 可直接打开）
  ipcMain.handle('report:exportWord', (_event, html: string, defaultName: string) =>
    saveWithDialog(
      '导出报表',
      `${defaultName}.doc`,
      [{ name: 'Word 文档', extensions: ['doc'] }],
      (filePath) => fs.writeFile(filePath, html, 'utf-8')
    )
  )

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
