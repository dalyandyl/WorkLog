import type {
  AttachmentMeta,
  JournalDay,
  JournalEntry,
  JournalEntryInput,
  MountedTask
} from '../shared/types'
import { readJson, writeJson, removeFile, withDataLock } from './jsonStore'
import { journalDayPath, journalRoot, journalYearDir } from './paths'
import { promises as fs } from 'fs'

export type { JournalDay, JournalEntry, MountedTask }
export { journalDayPath, journalRoot, journalYearDir }

/**
 * 日志数据层。
 *
 * 存储：`<root>/journal/<年>/<日期>.json`，一天一个文件，内容是 `{ date, entries: [...] }`。
 * 一天**可以有多条**条目（时间线式手记），按 `time`（HH:mm）升序排列。
 *
 * 设计要点：
 *   - 全部读写走 `jsonStore`（原子写 + 损坏隔离 + 全局写锁），不自己碰 fs；
 *   - 「读-改-写」全程持锁（`withDataLock`），避免并发丢更新；
 *   - 条目清空时**删除文件**而不是留一个空壳（与 `weekly.ts` 的语义一致）；
 *   - **日期必须校验**：`date` 来自渲染层并会参与拼接文件路径，
 *     不校验就可被 `../../` 之类穿越到数据目录之外（同 P3-2 的附件路径加固）。
 */

/** 天文件里允许出现的日期格式；同时用于阻断路径穿越 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidJournalDate(date: unknown): date is string {
  return typeof date === 'string' && DATE_RE.test(date)
}

function assertDate(date: string): void {
  if (!isValidJournalDate(date)) {
    throw new Error(`非法日志日期：${JSON.stringify(date)}`)
  }
}

/** 时间字段规范化：接受 `HH:mm`；其它一律当作空串（排序时排在最前） */
function normalizeTime(v: unknown): string {
  if (typeof v !== 'string') return ''
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m) return ''
  const h = Number(m[1])
  if (h < 0 || h > 23) return ''
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

function normalizeAttachments(v: unknown): AttachmentMeta[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      id: typeof a.id === 'string' ? a.id : '',
      name: typeof a.name === 'string' ? a.name : '',
      url: typeof a.url === 'string' ? a.url : '',
      type: a.type === 'image' ? ('image' as const) : ('file' as const)
    }))
    .filter((a) => a.url !== '')
}

function normalizeMountedTasks(v: unknown): MountedTask[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => ({
      taskId: typeof t.taskId === 'string' ? t.taskId : '',
      date: typeof t.date === 'string' ? t.date : '',
      title: typeof t.title === 'string' ? t.title : '',
      done: t.done === true
    }))
    .filter((t) => t.taskId !== '')
}

function normalizeEntry(raw: unknown): JournalEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id !== '' ? o.id : null
  if (!id) return null
  return {
    id,
    time: normalizeTime(o.time),
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
    body: typeof o.body === 'string' ? o.body : '',
    attachments: normalizeAttachments(o.attachments),
    mountedTasks: normalizeMountedTasks(o.mountedTasks)
  }
}

/** 一天之内的排序：先按 time（HH:mm 字典序即时间序），同刻按 createdAt 稳定 */
function sortEntries(entries: JournalEntry[]): JournalEntry[] {
  return entries.sort((a, b) => {
    if (a.time !== b.time) return a.time < b.time ? -1 : 1
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
  })
}

/**
 * 读取某天的条目（已规范化 + 排序）。
 * 文件不存在或已损坏 → 返回空数组（损坏文件已由 jsonStore 隔离并告警），**不返回 null**。
 */
export async function readJournalEntries(root: string, date: string): Promise<JournalEntry[]> {
  assertDate(date)
  const data = await readJson<{ date?: string; entries?: unknown } | null>(
    journalDayPath(root, date),
    null
  )
  if (!data || !Array.isArray(data.entries)) return []
  const entries = data.entries.map(normalizeEntry).filter((e): e is JournalEntry => e !== null)
  return sortEntries(entries)
}

/** 读取整天（含日期回填，供渲染层直接用） */
export async function readJournalDay(root: string, date: string): Promise<JournalDay> {
  return { date, entries: await readJournalEntries(root, date) }
}

/**
 * 「读-改-写」某天日志，全程持写锁。
 * `mutate` 返回空数组（或 null）时删除该天文件，避免留下空壳。
 */
async function mutateDay(
  root: string,
  date: string,
  mutate: (entries: JournalEntry[]) => JournalEntry[]
): Promise<JournalEntry[]> {
  assertDate(date)
  const file = journalDayPath(root, date)
  return withDataLock(async () => {
    const data = await readJson<{ date?: string; entries?: unknown } | null>(file, null)
    const current =
      data && Array.isArray(data.entries)
        ? data.entries.map(normalizeEntry).filter((e): e is JournalEntry => e !== null)
        : []
    const next = mutate(current)
    if (next.length === 0) {
      await removeFile(file)
      return []
    }
    await writeJson(file, { date, entries: sortEntries(next) })
    return next
  })
}

/**
 * 新增或更新一条日志条目（按 id upsert）。
 *
 * 传 `time` 为空串时会自动填当前时间 —— 新建条目时渲染层不必自己取时间。
 * 返回写入后的完整条目（已规范化），失败时抛错由 IPC 层转换。
 */
export async function saveJournalEntry(
  root: string,
  date: string,
  input: JournalEntryInput
): Promise<JournalEntry> {
  assertDate(date)
  const now = new Date()
  const id =
    typeof input.id === 'string' && input.id !== '' ? input.id : crypto.randomUUID()
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const iso = now.toISOString()

  let saved: JournalEntry | null = null
  await mutateDay(root, date, (current) => {
    const idx = current.findIndex((e) => e.id === id)
    const prev = idx >= 0 ? current[idx] : null
    const entry: JournalEntry = {
      id,
      time: normalizeTime(input.time) || prev?.time || hhmm,
      createdAt: prev?.createdAt || input.createdAt || iso,
      updatedAt: iso,
      body: typeof input.body === 'string' ? input.body : (prev?.body ?? ''),
      attachments: input.attachments
        ? normalizeAttachments(input.attachments)
        : (prev?.attachments ?? []),
      mountedTasks: input.mountedTasks
        ? normalizeMountedTasks(input.mountedTasks)
        : (prev?.mountedTasks ?? [])
    }
    saved = entry
    if (idx >= 0) {
      const next = current.slice()
      next[idx] = entry
      return next
    }
    return [...current, entry]
  })

  if (!saved) throw new Error('保存日志条目失败')
  return saved
}

/**
 * 删除一条日志条目，返回被删掉的条目（供回收站快照）。
 * 条目不存在时返回 null（幂等，不报错）。
 */
export async function deleteJournalEntry(
  root: string,
  date: string,
  id: string
): Promise<JournalEntry | null> {
  assertDate(date)
  let removed: JournalEntry | null = null
  await mutateDay(root, date, (current) => {
    const hit = current.find((e) => e.id === id)
    if (!hit) return current
    removed = hit
    return current.filter((e) => e.id !== id)
  })
  return removed
}

/** 该天是否存在日志（用于日历打点，避免把整天的正文读出来） */
export async function hasJournal(root: string, date: string): Promise<boolean> {
  if (!isValidJournalDate(date)) return false
  try {
    const st = await fs.stat(journalDayPath(root, date))
    return st.isFile() && st.size > 2
  } catch {
    return false
  }
}

/** 列出所有有日志的日期（升序） */
export async function listJournalDates(root: string): Promise<string[]> {
  const dates: string[] = []
  try {
    const years = await fs.readdir(journalRoot(root), { withFileTypes: true })
    for (const y of years) {
      if (!y.isDirectory() || !/^\d{4}$/.test(y.name)) continue
      let files: string[] = []
      try {
        files = await fs.readdir(journalYearDir(root, y.name))
      } catch {
        continue
      }
      for (const f of files) {
        const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f)
        if (m) dates.push(m[1])
      }
    }
  } catch {
    // journal 目录还不存在 —— 正常的空态
  }
  dates.sort()
  return dates
}

/**
 * 连续时间线模式：取 `limit` 天（按日期倒序，即从 `before` 往前翻）的日志。
 *
 * 一天一个文件，所以按天分批读即可；这里跳过没有条目的天，
 * 保证返回的每一天都有实际内容（前端不必再过滤空天）。
 */
export async function listJournalRange(
  root: string,
  opts: { before?: string; limit?: number } = {}
): Promise<JournalDay[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200)
  const all = await listJournalDates(root)
  const pool = opts.before && isValidJournalDate(opts.before)
    ? all.filter((d) => d < opts.before!)
    : all

  const out: JournalDay[] = []
  for (let i = pool.length - 1; i >= 0 && out.length < limit; i--) {
    const entries = await readJournalEntries(root, pool[i])
    if (entries.length > 0) out.push({ date: pool[i], entries })
  }
  return out
}
