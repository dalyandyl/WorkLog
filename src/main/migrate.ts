import { promises as fs } from 'fs'
import path from 'path'
import { tagsPath } from './tags'
import { listDatesWithTasks, readTasks } from './tasks'

/** 迁移完成标记文件名 */
export const MIGRATION_MARKER = '.migrated-v1.2'

export function markerPath(root: string): string {
  return path.join(root, MIGRATION_MARKER)
}

export async function isMigrated(root: string): Promise<boolean> {
  try {
    await fs.access(markerPath(root))
    return true
  } catch {
    return false
  }
}

/** 清除迁移标记（导入旧备份后应重新迁移） */
export async function resetMigration(root: string): Promise<void> {
  await fs.rm(markerPath(root), { force: true })
}

/**
 * 启动时一次性迁移旧版本数据：
 * 1) 旧标签无 createdAt → 用 tags.json 修改时间补全
 * 2) 旧周报文件 weekly/<weekKey>__<projectId>.json → weekly/<weekKey>.json
 * 3) 旧发布记录升级：补 subtasks/instances、去 projectIds
 * 4) 旧版日报直建任务（未被任何发布记录覆盖）→ 补录为发布记录，可在发布页管理
 */
export async function migrateLegacyData(root: string): Promise<void> {
  if (await isMigrated(root)) return
  await migrateTags(root)
  await migrateWeeklyFiles(root)
  await migratePublishHistory(root)
  await fs.writeFile(markerPath(root), new Date().toISOString(), 'utf-8')
}

/** 旧标签补 createdAt */
async function migrateTags(root: string): Promise<void> {
  const file = tagsPath(root)
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf-8')
  } catch {
    return
  }
  let tags: unknown
  try {
    tags = JSON.parse(raw)
  } catch {
    return
  }
  if (!Array.isArray(tags)) return
  let mtime = Date.now()
  try {
    mtime = (await fs.stat(file)).mtimeMs
  } catch {
    /* ignore */
  }
  const fallback = new Date(mtime).toISOString()
  let changed = false
  for (const t of tags) {
    if (t && typeof t === 'object' && !(t as { createdAt?: string }).createdAt) {
      ;(t as { createdAt: string }).createdAt = fallback
      changed = true
    }
  }
  if (changed) await fs.writeFile(file, JSON.stringify(tags, null, 2), 'utf-8')
}

/** 旧周报文件迁移 */
async function migrateWeeklyFiles(root: string): Promise<void> {
  const weeklyDir = path.join(root, 'weekly')
  let files: string[]
  try {
    files = await fs.readdir(weeklyDir)
  } catch {
    return
  }
  const byWeek = new Map<string, string[]>()
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const m = /^(.+?)__[^/]+\.json$/.exec(f)
    if (m) {
      const wk = m[1]
      if (!byWeek.has(wk)) byWeek.set(wk, [])
      byWeek.get(wk)!.push(f)
    }
  }
  for (const [wk, oldFiles] of byWeek) {
    const target = path.join(weeklyDir, `${wk}.json`)
    try {
      await fs.access(target)
      continue // 已存在新格式
    } catch {
      /* 目标不存在，需要迁移 */
    }
    let chosen = oldFiles[0]
    for (const f of oldFiles) {
      try {
        const data = JSON.parse(await fs.readFile(path.join(weeklyDir, f), 'utf-8')) as {
          summary?: unknown
        }
        if (typeof data.summary === 'string' && data.summary.trim()) {
          chosen = f
          break
        }
      } catch {
        /* ignore */
      }
    }
    await fs.copyFile(path.join(weeklyDir, chosen), target)
  }
}

/** 旧发布记录升级 + 旧日报任务补录 */
async function migratePublishHistory(root: string): Promise<void> {
  const historyFile = path.join(root, 'publish-history.json')
  let raw = ''
  try {
    raw = await fs.readFile(historyFile, 'utf-8')
  } catch {
    /* 无历史文件则跳过 */
  }
  let records: Array<Record<string, unknown>> = []
  if (raw.trim()) {
    try {
      const data = JSON.parse(raw) as { records?: Array<Record<string, unknown>> }
      records = Array.isArray(data?.records) ? data.records : []
    } catch {
      records = []
    }
  }

  // 1) 规范化：补 subtasks/instances，去 projectIds
  for (const r of records) {
    r.subtasks = Array.isArray(r.subtasks) ? r.subtasks : []
    r.tags = Array.isArray(r.tags) ? r.tags : []
    r.dates = Array.isArray(r.dates) ? r.dates : []
    r.instances = Array.isArray(r.instances) ? r.instances : []
    if (!r.publishedAt || typeof r.publishedAt !== 'string') r.publishedAt = new Date().toISOString()
    delete r.projectIds
  }

  const covered = new Set<string>()

  // 2) 旧记录没有 instances：按「标题相同 + 派发时间接近」在目标日期里重建
  for (const r of records) {
    const instances = r.instances as { date: string; taskId: string }[]
    if (instances.length > 0) {
      for (const inst of instances) covered.add(inst.taskId)
      continue
    }
    const pubTime = new Date(r.publishedAt as string).getTime()
    const dates = r.dates as string[]
    for (const d of dates) {
      const tasks = await readTasks(root, d)
      for (const t of tasks) {
        const tTime = new Date(t.publishedAt || t.createdAt).getTime()
        const sameTitle = (t.title || '').trim() === String(r.title || '').trim()
        const near = Math.abs(tTime - pubTime) < 24 * 3600 * 1000
        if (sameTitle && near) {
          instances.push({ date: d, taskId: t.id })
          covered.add(t.id)
          break
        }
      }
    }
  }

  // 3) 旧日报直建任务（未被任何记录覆盖）→ 补录为新发布记录
  const dates = await listDatesWithTasks(root)
  for (const d of dates) {
    const tasks = await readTasks(root, d)
    for (const t of tasks) {
      if (covered.has(t.id)) continue
      covered.add(t.id)
      records.unshift({
        id: crypto.randomUUID(),
        title: t.title || '未命名任务',
        tags: t.tags ?? [],
        dates: [d],
        body: t.body ?? '',
        subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
        publishedAt: t.publishedAt || t.createdAt || new Date().toISOString(),
        instances: [{ date: d, taskId: t.id }]
      })
    }
  }

  await fs.mkdir(path.dirname(historyFile), { recursive: true })
  await fs.writeFile(historyFile, JSON.stringify({ records }, null, 2), 'utf-8')
}
