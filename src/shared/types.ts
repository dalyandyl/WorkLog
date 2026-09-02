/** 主进程 / preload / 渲染层共享的数据类型 */

export type ThemeSetting = 'light' | 'dark' | 'system'

export interface ReminderSetting {
  enabled: boolean
  time: string // 'HH:MM'
}

export interface WebdavConfig {
  enabled: boolean
  url: string // 如 https://dav.jianguoyun.com/dav/
  username: string
  password: string
}

export interface AppSettings {
  theme: ThemeSetting
  reminder: ReminderSetting
  webdav: WebdavConfig
}

/** 项目 */
export interface Project {
  id: string
  name: string
  color: string // '#rrggbb'
  createdAt: string
}

/** 标签（全局标签库，多项目共享） */
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
  projectId: string // 归属项目
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
  projectId: string
}

/** 任务更新补丁 */
export interface TaskPatch {
  title?: string
  tags?: string[]
  done?: boolean
  body?: string
  subtasks?: Subtask[]
  projectId?: string
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
  projectId: string
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
  projectIds: string[] // 发布到的项目
  dates: string[] // 发布目标日期
  body: string // 正文 Markdown
  subtasks: Subtask[]
  publishedAt: string
  /** 本批次发布出的任务实例定位（删除整批时精确回收） */
  instances: { date: string; projectId: string; taskId: string }[]
}

/** 回收站中的单个任务实例（含其原属日期与项目） */
export interface TrashedTask {
  date: string
  projectId: string
  task: Task
}

/** 回收站条目（一次整批删除） */
export interface TrashItem {
  id: string
  title: string
  projectIds: string[]
  deletedAt: string
  tasks: TrashedTask[]
}

/** 导出 Markdown 的选项 */
export type ExportOptions = { projectId?: string } & (
  | { mode: 'day'; date: string }
  | { mode: 'week'; weekKey: string }
  | { mode: 'range'; start: string; end: string }
)
