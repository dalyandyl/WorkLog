export type {
  AccentColor,
  AppSettings,
  AttachmentMeta,
  DataWarning,
  DataWarningKind,
  ExportOptions,
  JournalDay,
  JournalEntry,
  JournalEntryInput,
  Meeting,
  MonthStats,
  MountedTask,
  NewTaskInput,
  PublishRecord,
  ReminderSetting,
  SearchHit,
  StickyNote,
  Subtask,
  Tag,
  TagCount,
  Task,
  TaskPatch,
  ThemeSetting,
  TrashItem,
  TrashedTask,
  UpdateSource,
  WebdavConfig,
  WeekInfo,
  WeeklySummary
} from '../../shared/types'

/** 用户反馈级别：info/success 短提示，error 停留更久且样式醒目 */
export type StatusLevel = 'info' | 'success' | 'error'

/**
 * 全局用户反馈通道（原「底部状态栏」的替代）。
 *
 * 历史上 `onStatus` 只传一个字符串，链路在 1.5.1 取消状态栏后失效，
 * 所有反馈（含错误）都被写进一个从未渲染的 state。现在统一由 App 收集为 Toast，
 * 第二个参数用于把错误类反馈标红并延长停留时间。
 */
export type StatusReporter = (msg: string, level?: StatusLevel) => void
