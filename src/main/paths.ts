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

export function meetingFileName(meetingId: string): string {
  return `${meetingId}.md.json`
}

export function meetingFilePath(root: string, meetingId: string): string {
  return path.join(meetingsDir(root), meetingFileName(meetingId))
}

export function attachmentsRoot(root: string): string {
  return path.join(root, 'attachments')
}
