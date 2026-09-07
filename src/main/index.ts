import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { getStorageRoot, migrateStorageRoot } from './storage'
import { checkForUpdates, downloadUpdate, initUpdater, installUpdate, setUpdateSource } from './updater'
import { readSettings, writeSettings, isRest, setRest } from './meta'
import type { UpdateSource } from '../shared/types'
import {
  createTask,
  datesOfTask,
  deleteTask,
  listDatesWithTasks,
  publishTasks,
  readTasks,
  readTasksMany,
  reorderTasks,
  restoreTasksToDays,
  updateTask,
  type NewTaskInput,
  type Task
} from './tasks'
import { createTag, deleteTag, listTags, recolorTag, renameTag } from './tags'
import {
  addTrashItem,
  clearTrash,
  listTrash,
  removeTrashItem,
  takeTrashItem
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
import { createTray, startReminder } from './tray'
import {
  attachmentUrlToPath,
  deleteAttachmentFile,
  importAttachmentFile,
  saveAttachmentBuffer
} from './attachments'
import type { Meeting } from '../shared/types'
import { listMeetings, saveMeeting, deleteMeeting } from './meetings'
import { meetingToMarkdown, meetingExportFileName } from './meetingExport'

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
    autoHideMenuBar: true,
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
    const dates = await datesOfTask(storageRoot, taskId)
    const trashedTasks: { date: string; task: Task }[] = []
    for (const d of dates) {
      const tasks = await readTasks(storageRoot, d)
      const task = tasks.find((t) => t.id === taskId)
      if (task) trashedTasks.push({ date: d, task })
    }
    if (trashedTasks.length === 0) return { ok: false }
    await addTrashItem(storageRoot, {
      id: crypto.randomUUID(),
      title: trashedTasks[0].task.title || '未命名任务',
      deletedAt: new Date().toISOString(),
      tasks: trashedTasks
    })
    await deleteTask(storageRoot, date, taskId)
    return { ok: true }
  })
  ipcMain.handle('tasks:reorder', (_event, date: string, orderedIds: string[]) =>
    reorderTasks(storageRoot, date, orderedIds)
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
    const item = await takeTrashItem(storageRoot, id)
    if (!item) return { ok: false }
    await restoreTasksToDays(
      storageRoot,
      item.tasks.map((t) => ({ date: t.date, task: t.task }))
    )
    return { ok: true }
  })

  // ---- 删除发布历史：整批任务进回收站 ----
  ipcMain.handle('history:trash', async (_event, id: string) => {
    const records = await readPublishRecords(storageRoot)
    const rec = records.find((r) => r.id === id)
    if (!rec) return { ok: false }
    // 区间共享任务同一 id 跨多天：先按唯一任务 id 收集所有日期的实例，再删除
    const trashedTasks: { date: string; task: Task }[] = []
    const seenTaskIds = new Set<string>()
    for (const inst of rec.instances ?? []) {
      if (seenTaskIds.has(inst.taskId)) continue
      seenTaskIds.add(inst.taskId)
      const dates = await datesOfTask(storageRoot, inst.taskId)
      for (const d of dates) {
        const tasks = await readTasks(storageRoot, d)
        const task = tasks.find((t) => t.id === inst.taskId)
        if (task) trashedTasks.push({ date: d, task })
      }
    }
    if (trashedTasks.length > 0) {
      await addTrashItem(storageRoot, {
        id: crypto.randomUUID(),
        title: rec.title,
        deletedAt: new Date().toISOString(),
        tasks: trashedTasks
      })
      // deleteTask 会同步删除所有包含该 id 的日期
      for (const taskId of seenTaskIds) {
        await deleteTask(storageRoot, trashedTasks[0].date, taskId)
      }
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

  // ---- 休息日 / 设置 ----
  ipcMain.handle('rest:get', (_event, date: string) => isRest(storageRoot, date))
  ipcMain.handle('rest:set', (_event, date: string, rest: boolean) =>
    setRest(storageRoot, date, rest)
  )
  ipcMain.handle('settings:get', () => readSettings(storageRoot))
  ipcMain.handle('settings:set', async (_event, s) => {
    await writeSettings(storageRoot, s)
    // 设置变化时同步应用更新镜像源（如设置页切换了镜像源）
    if (s && typeof s.updateSource === 'string') setUpdateSource(s.updateSource)
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

  // 单篇导出 Markdown（元信息头 + 正文转换 + 附件清单）
  ipcMain.handle('meetings:export', async (_event, meeting: Meeting) => {
    try {
      const tags = await listTags(storageRoot)
      const tagNames = (meeting.tags ?? [])
        .map((id) => tags.find((t) => t.id === id)?.name)
        .filter((n): n is string => Boolean(n))
      const md = meetingToMarkdown(meeting, tagNames)
      const options: Electron.SaveDialogOptions = {
        title: '导出会议纪要',
        defaultPath: meetingExportFileName(meeting),
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      }
      const win = BrowserWindow.getFocusedWindow()
      const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      await fs.writeFile(res.filePath, md, 'utf-8')
      return { ok: true, path: res.filePath }
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

      const options: Electron.SaveDialogOptions = {
        title: '导出 Markdown',
        defaultPath: defaultName,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      }
      const win = BrowserWindow.getFocusedWindow()
      const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }

      await fs.writeFile(res.filePath, content, 'utf-8')
      return { ok: true, path: res.filePath }
    } catch (err) {
      console.error('export:md failed:', err)
      return { ok: false, error: String(err) }
    }
  })

  // ---- 备份 ----
  ipcMain.handle('backup:export', async () => {
    try {
      const d = new Date()
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
      const options: Electron.SaveDialogOptions = {
        title: '导出备份',
        defaultPath: `日志工具备份-${stamp}.zip`,
        filters: [{ name: 'Zip 压缩包', extensions: ['zip'] }]
      }
      const win = BrowserWindow.getFocusedWindow()
      const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      await exportBackup(storageRoot, res.filePath)
      return { ok: true, path: res.filePath }
    } catch (err) {
      console.error('backup:export failed:', err)
      return { ok: false, error: String(err) }
    }
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
      return { ok: true }
    } catch (err) {
      console.error('backup:import failed:', err)
      return { ok: false, error: String(err) }
    }
  })

  createTray(showWindow)
  startReminder(storageRoot)
  createWindow()

  // ---- 自动更新（Gitee / GitHub 双通道，运行时经 API 校验令牌与仓库配置） ----
  initUpdater(broadcastUpdate)
  // 应用设置里保存的更新镜像源（auto / gitee / github）
  const initSettings = await readSettings(storageRoot)
  setUpdateSource(initSettings.updateSource)
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
  ipcMain.handle('update:install', () => installUpdate())
  ipcMain.handle('update:set-source', (_event, source: UpdateSource) => {
    setUpdateSource(source)
    return { ok: true }
  })

  // ---- WebDAV 跨设备同步 ----
  async function syncWithResult(which: 'push' | 'pull'): Promise<{ ok: boolean; error?: string }> {
    const s = await readSettings(storageRoot)
    if (!s.webdav.url || !s.webdav.username) {
      return { ok: false, error: '请先在设置中配置 WebDAV（地址 / 账号 / 密码）' }
    }
    const r = which === 'push' ? await webdavPush(storageRoot, s.webdav) : await webdavPull(storageRoot, s.webdav)
    if (r.ok) {
      s.webdav.lastSyncAt = new Date().toISOString()
      await writeSettings(storageRoot, s)
    }
    return r
  }
  ipcMain.handle('sync:push', () => syncWithResult('push'))
  ipcMain.handle('sync:pull', () => syncWithResult('pull'))
  ipcMain.handle('sync:localMtime', async () => ({ ok: true, mtime: await lastDataMtime(storageRoot) }))

  // 自动同步：启动时拉取 / 定时上传
  async function scheduleAutoSync(): Promise<void> {
    const s = await readSettings(storageRoot)
    if (!s.webdav.enabled || !s.webdav.url || !s.webdav.username) return
    if (s.webdav.autoMode === 'startup') {
      await syncWithResult('pull')
    }
    if (s.webdav.autoMode === 'interval') {
      const minutes = Math.max(5, s.webdav.intervalMinutes || 30)
      setInterval(() => {
        void syncWithResult('push')
      }, minutes * 60 * 1000)
    }
  }
  void scheduleAutoSync()

  // 退出时自动上传（仅一次）
  let exitPushed = false
  app.on('before-quit', (e) => {
    if (exitPushed) return
    exitPushed = true
    void (async () => {
      const s = await readSettings(storageRoot)
      if (s.webdav.enabled && s.webdav.autoMode === 'exit' && s.webdav.url && s.webdav.username) {
        e.preventDefault()
        await syncWithResult('push')
        app.quit()
      }
    })()
  })

  // ---- 报表导出（MD / Word） ----
  ipcMain.handle('report:exportMd', async (_event, md: string, defaultName: string) => {
    try {
      const options: Electron.SaveDialogOptions = {
        title: '导出报表',
        defaultPath: `${defaultName}.md`,
        filters: [{ name: 'Markdown 文件', extensions: ['md'] }]
      }
      const win = BrowserWindow.getFocusedWindow()
      const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      await fs.writeFile(res.filePath, md, 'utf-8')
      return { ok: true, path: res.filePath }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // Word 导出：以 HTML 内容保存为 .doc（Word/WPS 可直接打开）
  ipcMain.handle('report:exportWord', async (_event, html: string, defaultName: string) => {
    try {
      const options: Electron.SaveDialogOptions = {
        title: '导出报表',
        defaultPath: `${defaultName}.doc`,
        filters: [{ name: 'Word 文档', extensions: ['doc'] }]
      }
      const win = BrowserWindow.getFocusedWindow()
      const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      await fs.writeFile(res.filePath, html, 'utf-8')
      return { ok: true, path: res.filePath }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

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
