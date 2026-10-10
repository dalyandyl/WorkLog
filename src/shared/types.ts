/** 主进程 / preload / 渲染层共享的数据类型 */

export type ThemeSetting = 'light' | 'dark' | 'system'

/** 界面强调色（主题色）预设 */
export type AccentColor = 'blue' | 'indigo' | 'violet' | 'green' | 'rose' | 'amber'

/** 自动更新镜像源：auto=自动（Gitee 优先，失败回退 GitHub）/ gitee / github */
export type UpdateSource = 'auto' | 'gitee' | 'github'

export interface ReminderSetting {
  enabled: boolean
  time: string // 'HH:MM'
}

export interface WebdavConfig {
  enabled: boolean
  url: string // 如 https://dav.jianguoyun.com/dav/
  username: string
  password: string
  /** 自动同步时机：off=关闭 / startup=启动时拉取 / exit=退出时上传 / interval=定时上传 */
  autoMode: 'off' | 'startup' | 'exit' | 'interval'
  intervalMinutes: number
  /** 最近一次同步成功时间（ISO） */
  lastSyncAt: string | null
}

export interface AppSettings {
  theme: ThemeSetting
  /** 界面强调色 */
  accent: AccentColor
  reminder: ReminderSetting
  webdav: WebdavConfig
  /** 自动更新镜像源 */
  updateSource: UpdateSource
}

/** 标签（全局标签库） */
export interface Tag {
  id: string
  name: string
  color: string // '#rrggbb'
  createdAt: string
  /** 使用次数（列表查询时填充，非持久化字段） */
  useCount?: number
}

/** 子任务（仅标题，可勾选、带标签） */
export interface Subtask {
  id: string
  title: string
  done: boolean
  tags: string[] // 标签 id 列表
}

/** 任务 */
export interface Task {
  id: string
  title: string
  tags: string[] // 标签 id 列表
  done: boolean
  body: string // 正文 Markdown
  subtasks: Subtask[]
  note: string // 日报备注（共享，随任务）
  publishedAt: string // 派发时间（发布时刻）
  completedAt: string | null // 完成时间（勾选完成时刻，未完成 null）
  order: number
  createdAt: string
  updatedAt: string
}

/** 新建任务的输入 */
export interface NewTaskInput {
  title: string
  tags: string[]
  body: string
  subtasks: Subtask[]
}

/** 任务更新补丁 */
export interface TaskPatch {
  title?: string
  tags?: string[]
  done?: boolean
  body?: string
  subtasks?: Subtask[]
  note?: string
  completedAt?: string | null
}

/** ISO 周信息（周一起始） */
export interface WeekInfo {
  year: number
  week: number
  weekKey: string
  start: string
  end: string
  dates: string[]
}

/** 周报（周总结） */
export interface WeeklySummary {
  weekKey: string
  summary: string
  exists: boolean
}

/** 搜索命中 */
export interface SearchHit {
  date: string
  /** 命中来源：`task` = 任务（默认，兼容旧调用）；`journal` = 日志条目 */
  kind?: 'task' | 'journal'
  /** 任务 id；日志命中时为空串（保留字段以兼容既有调用方） */
  taskId: string
  /** 日志条目 id（仅 kind === 'journal' 时有值） */
  entryId?: string
  title: string
  snippet: string
}

/** 标签计数 */
export interface TagCount {
  tagId: string
  name: string
  color: string
  count: number
}

/** 月度统计 */
export interface MonthStats {
  year: number
  month: number
  totalDays: number
  daysWithTasks: number
  totalTasks: number
  doneTasks: number
  pendingTasks: number
  tagCounts: TagCount[]
  daily: { date: string; day: number; taskCount: number; doneCount: number }[]
}

/** 发布历史记录 */
export interface PublishRecord {
  id: string
  title: string
  tags: string[] // 标签 id 列表
  dates: string[] // 发布目标日期
  body: string // 正文 Markdown
  subtasks: Subtask[]
  publishedAt: string
  /** 本批次发布出的任务实例定位（删除整批时精确回收） */
  instances: { date: string; taskId: string }[]
}

/** 回收站中的单个任务实例（含其原属日期） */
export interface TrashedTask {
  date: string
  task: Task
}

/** 回收站中的单条日志条目（含其原属日期） */
export interface TrashedJournalEntry {
  date: string
  entry: JournalEntry
}

/**
 * 回收站条目（一次整批删除）。
 *
 * 目前有两类，靠 `journal` 字段区分：
 *   - **任务**：`tasks` 有内容、`journal` 为 undefined
 *   - **日志**：`journal` 有值、`tasks` 为**空数组**（不是 undefined，避免调用方直接 `.map` 抛错）
 */
export interface TrashItem {
  id: string
  title: string
  deletedAt: string
  tasks: TrashedTask[]
  journal?: TrashedJournalEntry
}

/** 导出 Markdown 的选项 */
export type ExportOptions =
  | { mode: 'day'; date: string }
  | { mode: 'week'; weekKey: string }
  | { mode: 'range'; start: string; end: string }

// ==================== 会议纪要功能类型定义 ====================

/** 附件元数据（图片或文件） */
export interface AttachmentMeta {
  id: string          // UUID
  name: string        // 文件名
  url: string         // wlattach:// 协议路径或本地相对路径
  type: 'image' | 'file'
}

/** 会议纪要 */
export interface Meeting {
  id: string              // UUID
  title: string           // 会议标题
  date: string            // YYYY-MM-DD（会议日期）
  tags: string[]          // 标签 id 列表，复用现有 Tag 库
  body: string            // Markdown + HTML 混合内容（富文本存储为带标签的 HTML）
  attachments: AttachmentMeta[]
  createdAt: string       // 创建时间 ISO
  updatedAt: string       // 最后修改时间 ISO
}

// ==================== 便签功能类型定义 ====================

/** 便签（置顶便签显示在日报任务列表上方；置顶 = 是否出现在日报的条件） */
export interface StickyNote {
  id: string              // UUID
  text: string            // 简短文本
  pinned: boolean         // 置顶 = 是否出现在日报
  completed: boolean      // 是否已完成（完成则从日报消失）
  createdAt: string       // 创建时间 ISO
  completedAt: string | null // 完成时间 ISO（未完成 null）
}

// ==================== 日志功能类型定义 ====================
//
// 「日志」是**独立于任务**的时间线式个人手记：一天可以写多条，每条带时间。
// 与任务的关系是**可选挂载**（可在日志里挂上当天做过的任务，也可以不挂）。

/**
 * 日志条目里「挂载的任务」——**快照式引用**。
 *
 * 语义（用户明确要求）：挂载时把任务标题抄下来，**之后任务改名或删除都不影响日志内容**；
 * 同时保留 `taskId` + `date`，仅用于「点击跳转」与「原任务已失效」的检测。
 *
 * 刻意**只存标题与完成状态**，不抄正文 —— 保持日志清爽，需要细节时点链接跳过去。
 */
export interface MountedTask {
  taskId: string          // 被挂载任务的 id
  date: string            // 该任务所在天 YYYY-MM-DD（跳转定位用）
  title: string           // 挂载当时的标题快照（不随任务改名而变）
  done: boolean           // 挂载当时的完成状态快照
}

/** 一条日志（同一天可有多条，按 `time` 排序） */
export interface JournalEntry {
  id: string              // UUID
  time: string            // HH:mm —— 一天内的展示与排序依据，可编辑
  createdAt: string       // 创建时间 ISO
  updatedAt: string       // 最后修改时间 ISO
  body: string            // 富文本 HTML（TipTap 产出；**渲染前必须经 sanitizeHtml**）
  attachments: AttachmentMeta[]  // 非图片附件（图片是内联在 body 里的 <img>）
  mountedTasks: MountedTask[]    // 可选挂载的当天任务快照
}

/** 某一天的日志文件内容 —— `logs/journal/<年>/<日期>.json` */
export interface JournalDay {
  date: string            // YYYY-MM-DD
  entries: JournalEntry[]
}

/**
 * 新建 / 更新日志条目的输入。
 *
 * 除 `id` 外全部可选：新建时由主进程补 `id`、`time`（缺省取当前时刻）、`createdAt`、`updatedAt`；
 * 更新已有条目时只传要改的字段，未传字段保持原值。
 */
export interface JournalEntryInput {
  id?: string
  time?: string
  body?: string
  attachments?: AttachmentMeta[]
  mountedTasks?: MountedTask[]
  createdAt?: string
}

// ==================== 数据层告警类型定义 ====================

export type DataWarningKind = 'corrupt' | 'write-failed'

/**
 * 数据层告警：由主进程经 `data:warning` 通道推送到渲染层，让用户知道
 * 「有文件损坏已被隔离备份」这类原本会被静默吞掉的问题。
 */
export interface DataWarning {
  kind: DataWarningKind
  /** 出错的文件绝对路径 */
  file: string
  /** 面向用户的中文说明 */
  message: string
  /** 损坏文件被改名隔离后的新路径（仅 kind === 'corrupt'） */
  quarantine?: string
}
