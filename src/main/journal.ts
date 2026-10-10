import type {
  AttachmentMeta,
  JournalDay,
  JournalDayInput,
  JournalDaySummary,
  JournalEntry,
  MountedTask
} from '../shared/types'
import { readJson, writeJson, removeFile, withDataLock } from './jsonStore'
import { journalDayPath, journalRoot, journalYearDir } from './paths'
import { promises as fs } from 'fs'

export type { JournalDay, JournalDayInput, JournalDaySummary, JournalEntry, MountedTask }
export { journalDayPath, journalRoot, journalYearDir }

/**
 * 日志数据层。
 *
 * 存储：`<root>/journal/<年>/<日期>.json`，**一天一篇连续文档**
 * （早期是「一天多条 entries[]」，界面上像一叠卡片；用户反馈与想要的 Word 式
 * 连续书写体验冲突，故改为一天一篇。旧格式仍可读，见 `normalizeDay`）。
 *
 * 设计要点：
 *   - 全部读写走 `jsonStore`（原子写 + 损坏隔离 + 全局写锁），不自己碰 fs；
 *   - 「读-改-写」全程持锁（`withDataLock`），避免并发丢更新；
 *   - 整天为空时**删除文件**而不是留一个空壳（与 `weekly.ts` 语义一致）；
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

/** 去掉 HTML 标签得到纯文本（列表预览与搜索共用） */
export function toPlainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
  const out: MountedTask[] = []
  const seen = new Set<string>()
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const t = raw as Record<string, unknown>
    const taskId = typeof t.taskId === 'string' ? t.taskId : ''
    if (!taskId || seen.has(taskId)) continue
    seen.add(taskId)
    out.push({
      taskId,
      date: typeof t.date === 'string' ? t.date : '',
      title: typeof t.title === 'string' ? t.title : '',
      done: t.done === true
    })
  }
  return out
}

/**
 * 把磁盘上的 JSON 规范化成 `JournalDay`。
 *
 * **向后兼容**：早期格式是 `{ date, entries: [{ time, body, … }] }`。
 * 遇到 `entries` 就按时间顺序合并成一整篇；**多条**时在每条前保留一个时间小标题 ——
 * 这样旧内容与它的时间信息都不会丢（用户当时可能已经写过东西）。
 * 单条时不加标题，避免凭空多出一个时间行。
 * 注意这里**只在读取时转换，不回写**：文件保持原样，直到用户真的保存那一天。
 */
function normalizeDay(date: string, raw: unknown): JournalDay | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  // ---- 旧格式：一天多条 ----
  if (Array.isArray(o.entries)) {
    const entries = o.entries
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((e) => ({
        time: typeof e.time === 'string' ? e.time : '',
        body: typeof e.body === 'string' ? e.body : '',
        createdAt: typeof e.createdAt === 'string' ? e.createdAt : '',
        updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : '',
        attachments: normalizeAttachments(e.attachments),
        mountedTasks: normalizeMountedTasks(e.mountedTasks)
      }))

    const meaningful = entries.filter((e) => e.body.trim() !== '' || e.attachments.length > 0)
    // 只有**多条**时才插入时间小标题：单条（最常见）保持干净，不凭空多出一个时间行
    const withTime = meaningful.length > 1
    const parts = meaningful.map((e) =>
      withTime && e.time ? `<p><strong>${e.time}</strong></p>${e.body}` : e.body
    )

    return {
      date,
      body: parts.join(''),
      attachments: entries.flatMap((e) => e.attachments),
      mountedTasks: normalizeMountedTasks(entries.flatMap((e) => e.mountedTasks)),
      createdAt: entries.map((e) => e.createdAt).filter(Boolean).sort()[0] ?? '',
      updatedAt: entries.map((e) => e.updatedAt).filter(Boolean).sort().pop() ?? ''
    }
  }

  // ---- 当前格式：一天一篇 ----
  const body = typeof o.body === 'string' ? o.body : ''
  const attachments = normalizeAttachments(o.attachments)
  const mountedTasks = normalizeMountedTasks(o.mountedTasks)

  return {
    date,
    body,
    attachments,
    mountedTasks,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : ''
  }
}

/** 该天是否算「写过」（有正文、附件或挂载任务） */
function isDayEmpty(day: Pick<JournalDay, 'body' | 'attachments' | 'mountedTasks'>): boolean {
  return toPlainText(day.body) === '' && day.attachments.length === 0 && day.mountedTasks.length === 0
}

/**
 * 读取某天的日志。
 * 文件不存在或已损坏 → 返回 `null`（损坏文件已由 jsonStore 隔离并告警），界面据此显示空文档。
 */
export async function readJournalDay(root: string, date: string): Promise<JournalDay | null> {
  assertDate(date)
  const raw = await readJson<unknown>(journalDayPath(root, date), null)
  if (raw === null) return null
  return normalizeDay(date, raw)
}

/** 只取正文（左栏预览、搜索等不需要完整结构时用） */
export async function readJournalBody(root: string, date: string): Promise<string> {
  const day = await readJournalDay(root, date)
  return day?.body ?? ''
}

/** 保存一整天的日志（覆盖式）。整天为空则删除文件。 */
export async function saveJournalDay(
  root: string,
  date: string,
  input: JournalDayInput
): Promise<JournalDay> {
  assertDate(date)
  const file = journalDayPath(root, date)
  const now = new Date().toISOString()

  return withDataLock(async () => {
    const prev = normalizeDay(date, await readJson<unknown>(file, null))
    const next: JournalDay = {
      date,
      body: typeof input.body === 'string' ? input.body : (prev?.body ?? ''),
      attachments: input.attachments
        ? normalizeAttachments(input.attachments)
        : (prev?.attachments ?? []),
      mountedTasks: input.mountedTasks
        ? normalizeMountedTasks(input.mountedTasks)
        : (prev?.mountedTasks ?? []),
      createdAt: prev?.createdAt || now,
      updatedAt: now
    }

    if (isDayEmpty(next)) {
      await removeFile(file)
      return next
    }
    await writeJson(file, next)
    return next
  })
}

/**
 * 删除某天的日志，返回被删掉的内容（供回收站快照）。
 * 该天不存在时返回 null（幂等，不报错）。
 */
export async function deleteJournalDay(root: string, date: string): Promise<JournalDay | null> {
  assertDate(date)
  const file = journalDayPath(root, date)
  return withDataLock(async () => {
    const prev = normalizeDay(date, await readJson<unknown>(file, null))
    await removeFile(file)
    return prev && !isDayEmpty(prev) ? prev : null
  })
}

/** 列出所有有日志的日期（升序）。空文件与纯空白的「空文档」不算。 */
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

/** 预览文本长度上限（左栏列表一行放不下更多） */
const PREVIEW_LEN = 70

/**
 * 左栏「天列表」用的摘要，**按日期倒序**（最近的在最上面），支持向前翻页。
 *
 * 一天一个文件，所以从最新的日期往回读即可；跳过实际为空的文档，
 * 保证返回的每一天都有内容（前端不必再过滤）。
 */
export async function listJournalSummaries(
  root: string,
  opts: { before?: string; limit?: number } = {}
): Promise<JournalDaySummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 200)
  const all = await listJournalDates(root)
  const pool =
    opts.before && isValidJournalDate(opts.before) ? all.filter((d) => d < opts.before!) : all

  const out: JournalDaySummary[] = []
  for (let i = pool.length - 1; i >= 0 && out.length < limit; i--) {
    const day = await readJournalDay(root, pool[i])
    if (!day || isDayEmpty(day)) continue
    const plain = toPlainText(day.body)
    out.push({
      date: pool[i],
      preview: plain.length > PREVIEW_LEN ? plain.slice(0, PREVIEW_LEN) + '…' : plain,
      updatedAt: day.updatedAt,
      mountedCount: day.mountedTasks.length
    })
  }
  return out
}
