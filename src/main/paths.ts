import path from 'path'

/**
 * 数据文件路径的唯一真源。
 *
 * 改造前每个模块各自 `path.join(root, 'xxx.json')`，路径字面量散落在 8 个文件里
 * （`migrate.ts` 甚至硬编码了 `weekly/` 与 `publish-history.json`），
 * 改名时必然漏改。这里集中定义，模块按需 re-export 保持既有调用方不变。
 */

// ---- 任务天文件 ----

export function dayFilePath(root: string, date: string): string {
  const year = date.slice(0, 4)
  return path.join(root, year, `${date}.json`)
}

/** 天文件所在目录（按年分片） */
export function dayFileDir(root: string, year: string): string {
  return path.join(root, year)
}

// ---- 单文件数据 ----

export function settingsPath(root: string): string {
  return path.join(root, 'settings.json')
}

export function tagsPath(root: string): string {
  return path.join(root, 'tags.json')
}

export function trashPath(root: string): string {
  return path.join(root, 'trash.json')
}

export function historyPath(root: string): string {
  return path.join(root, 'publish-history.json')
}

export function stickyNotesPath(root: string): string {
  return path.join(root, 'stickyNotes.json')
}

export function migrationMarkerPath(root: string): string {
  return path.join(root, '.migrated-v1.2')
}

// ---- 目录型数据 ----

export function weeklyDir(root: string): string {
  return path.join(root, 'weekly')
}

export function weeklyPath(root: string, weekKey: string): string {
  return path.join(weeklyDir(root), `${weekKey}.json`)
}

export function meetingsDir(root: string): string {
  return path.join(root, 'meetings')
}

/**
 * 日志根目录：`<root>/journal/<年>/<日期>.json`
 *
 * 注意这里的层级：`journal` 下的第一层是**年份目录**，第二层才是天文件。
 * 这样安排是为了与任务天文件（`<root>/<年>/<日期>.json`）保持同构，
 * 同时**不会**被 `tasks.listDatesWithTasks` 误判为任务天文件
 * （它只匹配 `<年>/YYYY-MM-DD.json` 这一层的文件名，而 `journal/` 下第一层是 `2026` 这样的目录名）。
 * 但那是巧合而非保证 —— 该函数已同时加上「目录名必须是 4 位年份」的显式约束。
 */
export function journalRoot(root: string): string {
  return path.join(root, 'journal')
}

export function journalYearDir(root: string, year: string): string {
  return path.join(journalRoot(root), year)
}

export function journalDayPath(root: string, date: string): string {
  return path.join(journalYearDir(root, date.slice(0, 4)), `${date}.json`)
}

export function meetingFileName(meetingId: string): string {
  return `${meetingId}.md.json`
}

export function meetingFilePath(root: string, meetingId: string): string {
  return path.join(meetingsDir(root), meetingFileName(meetingId))
}

export function attachmentsRoot(root: string): string {
  return path.join(root, 'attachments')
}
