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
  taskId: string
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

/** 回收站条目（一次整批删除） */
export interface TrashItem {
  id: string
  title: string
  deletedAt: string
  tasks: TrashedTask[]
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
