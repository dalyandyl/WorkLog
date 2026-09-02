import type {
  AppSettings,
  ExportOptions,
  MonthStats,
  NewTaskInput,
  PublishRecord,
  SearchHit,
  Tag,
  Task,
  TaskPatch,
  TrashItem,
  WeekInfo,
  WeeklySummary
} from '../shared/types'

export interface WorkLogApi {
  getStorageRoot(): Promise<string>

  // 任务
  readTasks(date: string): Promise<Task[]>
  readTasksMany(dates: string[]): Promise<Record<string, Task[]>>
  listTaskDates(): Promise<string[]>
  createTask(date: string, input: NewTaskInput): Promise<Task>
  updateTask(date: string, taskId: string, patch: TaskPatch): Promise<Task | null>
  deleteTask(date: string, taskId: string): Promise<{ ok: boolean }>
  trashTask(date: string, taskId: string): Promise<{ ok: boolean }>
  reorderTasks(date: string, orderedIds: string[]): Promise<void>
  publishTasks(
    dates: string[],
    input: NewTaskInput
  ): Promise<{ count: number; instances: { date: string; taskId: string }[] }>

  // 标签
  listTags(): Promise<Tag[]>
  createTag(name: string, color: string): Promise<Tag | null>
  renameTag(id: string, name: string): Promise<Tag | null>
  recolorTag(id: string, color: string): Promise<Tag | null>
  deleteTag(id: string): Promise<{ ok: boolean }>

  // 回收站
  listTrash(): Promise<TrashItem[]>
  restoreTrash(id: string): Promise<{ ok: boolean }>
  removeTrash(id: string): Promise<{ ok: boolean }>
  clearTrash(): Promise<{ ok: boolean }>
  trashPublishRecord(id: string): Promise<{ ok: boolean }>

  // 周报
  getWeekInfoByKey(weekKey: string): Promise<WeekInfo | null>
  readWeeklySummary(weekKey: string): Promise<WeeklySummary>
  writeWeeklySummary(weekKey: string, summary: string): Promise<{ ok: boolean }>
  shiftWeekKey(weekKey: string, delta: number): Promise<string | null>

  // 休息日 / 设置
  isRest(date: string): Promise<boolean>
  setRest(date: string, rest: boolean): Promise<{ ok: boolean }>
  getSettings(): Promise<AppSettings>
  setSettings(s: AppSettings): Promise<void>

  // 搜索 / 统计
  searchTasks(query: string): Promise<SearchHit[]>
  rangeStats(start: string, end: string): Promise<MonthStats>

  // 发布历史
  listPublishHistory(): Promise<PublishRecord[]>
  deletePublishRecord(id: string): Promise<{ ok: boolean }>

  // 节假日
  fetchHoliday(year: number): Promise<{
    ok: boolean
    holiday?: Record<string, string>
    workday?: Record<string, string>
    error?: string
  }>
  exportMarkdown(
    opts: ExportOptions
  ): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>

  // 备份 / 同步
  backupExport(): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
  backupImport(): Promise<{ ok: boolean; canceled?: boolean; error?: string }>
  syncPush(): Promise<{ ok: boolean; error?: string }>
  syncPull(): Promise<{ ok: boolean; error?: string }>

  // 附件
  saveAttachmentImage(folder: string, name: string, buf: ArrayBuffer): Promise<string>
  pickAttachmentFiles(folder: string): Promise<{
    ok: boolean
    canceled?: boolean
    files?: { url: string; name: string }[]
    error?: string
  }>
  openAttachment(url: string): Promise<{ ok: boolean; error?: string }>

  // 系统信息 / 更新
  getAppInfo(): Promise<{
    appVersion: string
    electron: string
    chrome: string
    node: string
    platform: string
    arch: string
    packaged: boolean
  }>
  checkUpdate(): Promise<{ ok: boolean; message?: string }>
  installUpdate(): Promise<{ ok: boolean }>
  onUpdateEvent(cb: (data: { channel: string; payload: Record<string, unknown> }) => void): () => void

  // 报表导出
  exportReportMd(
    md: string,
    defaultName: string
  ): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
  exportReportWord(
    html: string,
    defaultName: string
  ): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
}

declare global {
  interface Window {
    api: WorkLogApi
  }
}

export {}
