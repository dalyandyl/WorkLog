/**
 * `npm run ui:shot` 的 mock `window.api`（开发工具，不参与打包）。
 *
 * 用途：让**渲染层可以在没有主进程的情况下独立跑起来**，从而能headless 截图做视觉验证。
 * 背景：本项目的界面改动长期只过 typecheck/build，**从没人看过画面**；
 * 而 agent 也无法操作真实窗口。有了它就能把界面渲染成 PNG 再逐像素/肉眼检查。
 *
 * 数据是**合成的**（只为评估布局与排版），不读真实数据、不写任何文件。
 */
const { contextBridge } = require('electron')

const TAGS = [
  { id: 'tg1', name: '工作', color: '#3b82f6' },
  { id: 'tg2', name: '学习', color: '#10b981' }
]

/** 合成几天日志，用来观察左栏列表的观感（含长短不一的预览） */
const SUMMARIES = [
  { date: '2026-10-10', preview: '今天研究了苹果派的做法，顺便把配料表整理了一版，下周试着烤一次看看效果', updatedAt: '2026-10-10T09:40:00.000Z', mountedCount: 2 },
  { date: '2026-10-09', preview: '和客户对齐了需求边界，确认第一版只做日志与任务的拆分', updatedAt: '2026-10-09T11:00:00.000Z', mountedCount: 1 },
  { date: '2026-10-08', preview: '修了一整天的图片显示问题，最后发现是 IPC 返回值类型不对', updatedAt: '2026-10-08T13:20:00.000Z', mountedCount: 0 },
  { date: '2026-10-07', preview: '休息。看完了《设计中的设计》最后两章', updatedAt: '2026-10-07T20:10:00.000Z', mountedCount: 0 },
  { date: '2026-10-06', preview: '把编辑器的黄框问题记下来，等有空再查', updatedAt: '2026-10-06T15:00:00.000Z', mountedCount: 3 },
  { date: '2026-10-05', preview: '整理了下季度的计划', updatedAt: '2026-10-05T09:00:00.000Z', mountedCount: 0 }
]

/** 当天正文：故意包含标题 / 段落 / 列表 / 表格 / 引用，用来检验纸张排版 */
const BODY = `<h2>今天的进展</h2>
<p>上午把<strong>日志模块</strong>的数据模型改成了「一天一篇」，原先的多条卡片在写作时总是被打断。</p>
<p>下午调排版：字号 15.5px、行距 1.95，段落之间留出更多呼吸感。</p>
<ul><li>左栏天列表：倒序 + 内容预览</li><li>右栏：居中定宽的一张纸</li><li>自动保存，不用点保存</li></ul>
<h3>明天要做</h3>
<ol><li>把黄框查清楚</li><li>日历上加上「有日志」的小点</li></ol>
<table><tbody><tr><th>项</th><th>状态</th></tr><tr><td>左栏列表</td><td>完成</td></tr><tr><td>自动保存</td><td>完成</td></tr></tbody></table>
<blockquote><p>写作工具的手感，一半来自排版。</p></blockquote>`

const baseTask = (id, title, done, tags) => ({
  id,
  title,
  tags,
  done,
  body: '',
  subtasks: [],
  note: '',
  publishedAt: '2026-10-10T01:00:00.000Z',
  completedAt: done ? '2026-10-10T08:00:00.000Z' : null,
  order: 0,
  createdAt: '2026-10-10T01:00:00.000Z',
  updatedAt: '2026-10-10T01:00:00.000Z'
})

const TASKS = [
  baseTask('t1', '把黄框查清楚', false, ['tg1']),
  baseTask('t2', '整理配料表', true, []),
  baseTask('t3', '给日历加上日志打点', false, ['tg2'])
]

const SETTINGS = {
  theme: 'light',
  accent: 'violet',
  reminder: { enabled: false, time: '18:00' },
  webdav: { enabled: false, url: '', username: '', password: '', autoMode: 'off', intervalMinutes: 30, lastSyncAt: null },
  updateSource: 'auto'
}

const noopUnsub = () => () => {}

/**
 * 记录 `saveJournalDay` 的调用（日期 + 正文长度）。
 *
 * 用来验证一条关键数据路径：**在「手动挑的某一天」里写字，是否真的存到了那一天**
 * （而不是当前/今天）。通过 `window.api.getMockSaves()` 读出来。
 */
const mockSaves = []

contextBridge.exposeInMainWorld('api', {
  // ---- 设置 / 环境 ----
  getSettings: async () => SETTINGS,
  setSettings: async () => undefined,
  getStorageRoot: async () => 'D:\\mock\\logs',
  getAppInfo: async () => ({
    appVersion: '1.5.4',
    electron: '44.0.0',
    chrome: '142',
    node: '24',
    platform: 'win32',
    arch: 'x64',
    packaged: false
  }),
  onUpdateEvent: noopUnsub,
  onDataWarning: noopUnsub,
  checkUpdate: async () => ({ ok: false, message: '开发模式' }),
  downloadUpdate: async () => ({ ok: false }),
  cancelUpdate: async () => ({ ok: true }),
  installUpdate: async () => ({ ok: false }),
  setUpdateSource: async () => ({ ok: true }),

  // ---- 任务 / 标签 / 便签 ----
  readTasks: async () => TASKS,
  readTasksMany: async () => ({}),
  listTaskDates: async () => ['2026-10-05', '2026-10-06', '2026-10-08', '2026-10-09', '2026-10-10'],
  datesOfTask: async () => ['2026-10-10'],
  createTask: async () => null,
  updateTask: async () => null,
  deleteTask: async () => ({ ok: true }),
  trashTask: async () => ({ ok: true }),
  reorderTasks: async () => undefined,
  postponeTask: async () => ({ ok: true, added: 0 }),
  publishTasks: async () => ({ count: 0, instances: [] }),
  listTags: async () => TAGS,
  createTag: async () => null,
  renameTag: async () => null,
  recolorTag: async () => null,
  deleteTag: async () => ({ ok: true }),
  listStickyNotes: async () => [],
  addStickyNote: async () => null,
  updateStickyNote: async () => null,
  deleteStickyNote: async () => ({ ok: true }),
  listTrash: async () => [],
  removeTrash: async () => ({ ok: true }),
  restoreTrash: async () => ({ ok: true }),
  clearTrash: async () => ({ ok: true }),

  // ---- 日志 ----
  listJournalDates: async () => SUMMARIES.map((s) => s.date),
  listJournalSummaries: async () => SUMMARIES,
  // 只有 SUMMARIES 里列出的日期有内容，其它日期返回 null（用于检验「未写过的空白页」）
  // WL_MOCK_BLANK=1 可强制所有日期都返回空，用来单独截「空白页」状态
  readJournalDay: async (date) => {
    if (process.env.WL_MOCK_BLANK === '1') {
      return {
        date,
        body: '',
        attachments: [],
        mountedTasks: [],
        createdAt: '',
        updatedAt: ''
      }
    }
    if (!SUMMARIES.some((s) => s.date === date)) return null
    return {
      date,
      body: BODY,
      attachments: [
        { id: 'at1', name: '配料表.xlsx', url: 'wlattach://attachments/journal/x.xlsx', type: 'file' }
      ],
      mountedTasks: [
        { taskId: 't1', date, title: '把黄框查清楚', done: false },
        { taskId: 't2', date, title: '整理配料表', done: true }
      ],
      createdAt: '2026-10-10T01:00:00.000Z',
      updatedAt: '2026-10-10T09:40:00.000Z'
    }
  },
  saveJournalDay: async (date, day) => {
    mockSaves.push({ date, bodyLength: (day.body ?? '').length })
    return {
      ok: true,
      day: {
        date,
        body: day.body ?? BODY,
        attachments: day.attachments ?? [],
        mountedTasks: day.mountedTasks ?? [],
        createdAt: '2026-10-10T01:00:00.000Z',
        updatedAt: new Date().toISOString()
      }
    }
  },
  deleteJournalDay: async () => ({ ok: true, day: null }),
  /** 仅夹具用：读出 saveJournalDay 的调用记录 */
  getMockSaves: async () => mockSaves,

  // ---- 其余（截某一页时用不到，给安全的空实现）----
  // ---- 搜索（用于验证「搜索命中日志 → 跳到日志页那一天」这条路径）----
  searchTasks: async () => [
    {
      date: '2026-10-07',
      kind: 'task',
      taskId: 't9',
      title: '买苹果派原料',
      snippet: '…苹果派…'
    }
  ],
  searchAll: async () => [
    {
      date: '2026-10-07',
      kind: 'task',
      taskId: 't9',
      title: '买苹果派原料',
      snippet: '…苹果派…'
    },
    {
      date: '2026-10-06',
      kind: 'journal',
      taskId: '',
      title: '日志',
      snippet: '…记一下苹果派的做法…'
    }
  ],
  rangeStats: async () => ({}),
  listPublishHistory: async () => [],
  deletePublishRecord: async () => ({ ok: true }),
  trashPublishRecord: async () => ({ ok: true }),
  listMeetings: async () => [],
  saveMeeting: async () => ({ ok: true }),
  deleteMeeting: async () => ({ ok: true }),
  saveMeetingAttachment: async () => '',
  saveAttachmentImage: async () => '',
  pickAttachmentFiles: async () => ({ ok: false, canceled: true }),
  openAttachment: async () => ({ ok: true }),
  deleteAttachment: async () => ({ ok: true }),
  readWeeklySummary: async () => ({ weekKey: '', summary: '', exists: false }),
  writeWeeklySummary: async () => ({ ok: true }),
  getWeekInfoByKey: async () => null,
  shiftWeekKey: async () => null,
  fetchHoliday: async () => ({ ok: false }),
  syncPush: async () => ({ ok: false }),
  syncPull: async () => ({ ok: false }),
  syncLocalMtime: async () => ({ ok: true, mtime: Date.now() })
})
