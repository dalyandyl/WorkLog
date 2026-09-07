import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  ExportOptions,
  Meeting,
  MonthStats,
  NewTaskInput,
  PublishRecord,
  SearchHit,
  Tag,
  Task,
  TaskPatch,
  TrashItem,
  UpdateSource,
  WeekInfo,
  WeeklySummary,
  AttachmentMeta
} from '../shared/types'

export type WorkLogApi = {
  getStorageRoot: () => Promise<string>
  readTasks: (date: string) => Promise<Task[]>
  readTasksMany: (dates: string[]) => Promise<Record<string, Task[]>>
  listTaskDates: () => Promise<string[]>
  createTask: (date: string, input: NewTaskInput) => Promise<Task>
  updateTask: (date: string, taskId: string, patch: TaskPatch) => Promise<Task | null>
  deleteTask: (date: string, taskId: string) => Promise<{ ok: boolean }>
  trashTask: (date: string, taskId: string) => Promise<{ ok: boolean }>
  reorderTasks: (date: string, orderedIds: string[]) => Promise<void>
  publishTasks: (dates: string[], input: NewTaskInput) => Promise<{ count: number; instances: { date: string; taskId: string }[] }>
  listTags: () => Promise<Tag[]>
  createTag: (name: string, color: string) => Promise<Tag | null>
  renameTag: (id: string, name: string) => Promise<Tag | null>
  recolorTag: (id: string, color: string) => Promise<Tag | null>
  deleteTag: (id: string) => Promise<{ ok: boolean }>
  listTrash: () => Promise<TrashItem[]>
  restoreTrash: (id: string) => Promise<{ ok: boolean }>
  removeTrash: (id: string) => Promise<{ ok: boolean }>
  clearTrash: () => Promise<{ ok: boolean }>
  trashPublishRecord: (id: string) => Promise<{ ok: boolean }>
  getWeekInfoByKey: (weekKey: string) => Promise<WeekInfo | null>
  readWeeklySummary: (weekKey: string) => Promise<WeeklySummary>
  writeWeeklySummary: (weekKey: string, summary: string) => Promise<{ ok: boolean }>
  shiftWeekKey: (weekKey: string, delta: number) => Promise<string | null>
  isRest: (date: string) => Promise<boolean>
  setRest: (date: string, rest: boolean) => Promise<{ ok: boolean }>
  getSettings: () => Promise<AppSettings>
  setSettings: (s: AppSettings) => Promise<void>
  searchTasks: (query: string) => Promise<SearchHit[]>
  rangeStats: (start: string, end: string) => Promise<MonthStats>
  listPublishHistory: () => Promise<PublishRecord[]>
  deletePublishRecord: (id: string) => Promise<{ ok: boolean }>
  fetchHoliday: (year: number) => Promise<{ ok: boolean; holiday?: Record<string, string>; workday?: Record<string, string>; error?: string }>
  exportMarkdown: (opts: ExportOptions) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
  backupExport: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
  backupImport: () => Promise<{ ok: boolean; canceled?: boolean; error?: string }>
  syncPush: () => Promise<{ ok: boolean; error?: string }>
  syncPull: () => Promise<{ ok: boolean; error?: string }>
  syncLocalMtime: () => Promise<{ ok: boolean; mtime: number }>
  saveAttachmentImage: (folder: string, name: string, buf: ArrayBuffer) => Promise<string>
  pickAttachmentFiles: (folder: string) => Promise<{ ok: boolean; canceled?: boolean; files?: { url: string; name: string }[]; error?: string }>
  openAttachment: (url: string) => Promise<{ ok: boolean; error?: string }>
  deleteAttachment: (url: string) => Promise<{ ok: boolean; error?: string }>
  listMeetings: () => Promise<Meeting[]>
  saveMeeting: (meeting: Meeting) => Promise<{ ok: boolean }>
  deleteMeeting: (id: string) => Promise<{ ok: boolean }>
  saveMeetingAttachment: (meetingId: string, name: string, buf: ArrayBuffer) => Promise<string>
  exportMeeting: (meeting: Meeting) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
  getAppInfo: () => Promise<{ appVersion: string; electron: string; chrome: string; node: string; platform: string; arch: string; packaged: boolean }>
  checkUpdate: () => Promise<{ ok: boolean; message?: string }>
  downloadUpdate: () => Promise<{ ok: boolean; message?: string }>
  installUpdate: () => Promise<{ ok: boolean }>
  setUpdateSource: (source: UpdateSource) => Promise<{ ok: boolean }>
  exportReportMd: (md: string, defaultName: string) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
  exportReportWord: (html: string, defaultName: string) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
  onUpdateEvent: (cb: (data: { channel: string; payload: Record<string, unknown> }) => void) => () => void
}

const api: WorkLogApi = {
  getStorageRoot: (): Promise<string> => ipcRenderer.invoke('storage:root'),

  // ---- 任务 ----
  readTasks: (date: string): Promise<Task[]> => ipcRenderer.invoke('tasks:read', date),
  readTasksMany: (dates: string[]): Promise<Record<string, Task[]>> =>
    ipcRenderer.invoke('tasks:readMany', dates),
  listTaskDates: (): Promise<string[]> => ipcRenderer.invoke('tasks:listDates'),
  createTask: (date: string, input: NewTaskInput): Promise<Task> =>
    ipcRenderer.invoke('tasks:create', date, input),
  updateTask: (date: string, taskId: string, patch: TaskPatch): Promise<Task | null> =>
    ipcRenderer.invoke('tasks:update', date, taskId, patch),
  deleteTask: (date: string, taskId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('tasks:delete', date, taskId),
  trashTask: (date: string, taskId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('tasks:trash', date, taskId),
  reorderTasks: (date: string, orderedIds: string[]): Promise<void> =>
    ipcRenderer.invoke('tasks:reorder', date, orderedIds),
  publishTasks: (
    dates: string[],
    input: NewTaskInput
  ): Promise<{ count: number; instances: { date: string; taskId: string }[] }> =>
    ipcRenderer.invoke('tasks:publish', dates, input),

  // ---- 标签库 ----
  listTags: (): Promise<Tag[]> => ipcRenderer.invoke('tags:list'),
  createTag: (name: string, color: string): Promise<Tag | null> =>
    ipcRenderer.invoke('tags:create', name, color),
  renameTag: (id: string, name: string): Promise<Tag | null> =>
    ipcRenderer.invoke('tags:rename', id, name),
  recolorTag: (id: string, color: string): Promise<Tag | null> =>
    ipcRenderer.invoke('tags:recolor', id, color),
  deleteTag: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('tags:delete', id),

  // ---- 回收站 ----
  listTrash: (): Promise<TrashItem[]> => ipcRenderer.invoke('trash:list'),
  restoreTrash: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('trash:restore', id),
  removeTrash: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('trash:remove', id),
  clearTrash: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('trash:clear'),
  trashPublishRecord: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('history:trash', id),

  // ---- 周报 ----
  getWeekInfoByKey: (weekKey: string): Promise<WeekInfo | null> =>
    ipcRenderer.invoke('weekly:info', weekKey),
  readWeeklySummary: (weekKey: string): Promise<WeeklySummary> =>
    ipcRenderer.invoke('weekly:read', weekKey),
  writeWeeklySummary: (
    weekKey: string,
    summary: string
  ): Promise<{ ok: boolean }> => ipcRenderer.invoke('weekly:write', weekKey, summary),
  shiftWeekKey: (weekKey: string, delta: number): Promise<string | null> =>
    ipcRenderer.invoke('weekly:shift', weekKey, delta),

  // ---- 休息日 / 设置 ----
  isRest: (date: string): Promise<boolean> => ipcRenderer.invoke('rest:get', date),
  setRest: (date: string, rest: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('rest:set', date, rest),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (s: AppSettings): Promise<void> => ipcRenderer.invoke('settings:set', s),

  // ---- 搜索 / 统计 / 导出 ----
  searchTasks: (query: string): Promise<SearchHit[]> =>
    ipcRenderer.invoke('search:tasks', query),
  rangeStats: (start: string, end: string): Promise<MonthStats> =>
    ipcRenderer.invoke('stats:range', start, end),

  // ---- 发布历史 ----
  listPublishHistory: (): Promise<PublishRecord[]> => ipcRenderer.invoke('history:list'),
  deletePublishRecord: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('history:delete', id),

  // ---- 法定节假日 ----
  fetchHoliday: (
    year: number
  ): Promise<{
    ok: boolean
    holiday?: Record<string, string>
    workday?: Record<string, string>
    error?: string
  }> => ipcRenderer.invoke('holiday:fetch', year),
  exportMarkdown: (
    opts: ExportOptions
  ): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('export:md', opts),

  // ---- 备份 / 同步 ----
  backupExport: (): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('backup:export'),
  backupImport: (): Promise<{ ok: boolean; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke('backup:import'),
  syncPush: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('sync:push'),
  syncPull: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('sync:pull'),
  syncLocalMtime: (): Promise<{ ok: boolean; mtime: number }> =>
    ipcRenderer.invoke('sync:localMtime'),

  // ---- 附件 ----
  saveAttachmentImage: (folder: string, name: string, buf: ArrayBuffer): Promise<string> =>
    ipcRenderer.invoke('attach:saveImage', folder, name, buf),
  pickAttachmentFiles: (
    folder: string
  ): Promise<{
    ok: boolean
    canceled?: boolean
    files?: { url: string; name: string }[]
    error?: string
  }> => ipcRenderer.invoke('attach:pickFile', folder),
  openAttachment: (url: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('attach:open', url),
  deleteAttachment: (url: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('attach:delete', url),

  // ---- 会议纪要 ----
  listMeetings: (): Promise<Meeting[]> => ipcRenderer.invoke('meetings:list'),
  saveMeeting: (meeting: Meeting): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('meetings:save', meeting),
  deleteMeeting: (id: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('meetings:delete', id),
  saveMeetingAttachment: (meetingId: string, name: string, buf: ArrayBuffer): Promise<string> =>
    ipcRenderer.invoke('attach:saveImage', `meetings/${meetingId}`, name, buf),
  exportMeeting: (meeting: Meeting): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('meetings:export', meeting),

  // ---- 系统信息 / 自动更新 ----
  getAppInfo: (): Promise<{
    appVersion: string
    electron: string
    chrome: string
    node: string
    platform: string
    arch: string
    packaged: boolean
  }> => ipcRenderer.invoke('app:getInfo'),
  checkUpdate: (): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke('update:check'),
  downloadUpdate: (): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke('update:download'),
  installUpdate: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('update:install'),
  setUpdateSource: (source: UpdateSource): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('update:set-source', source),

  // ---- 报表导出 ----
  exportReportMd: (
    md: string,
    defaultName: string
  ): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('report:exportMd', md, defaultName),
  exportReportWord: (
    html: string,
    defaultName: string
  ): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('report:exportWord', html, defaultName),
  onUpdateEvent: (
    cb: (data: { channel: string; payload: Record<string, unknown> }) => void
  ): (() => void) => {
    const handler = (_e: unknown, data: { channel: string; payload: Record<string, unknown> }): void =>
      cb(data)
    ipcRenderer.on('update:event', handler)
    return () => ipcRenderer.removeListener('update:event', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
