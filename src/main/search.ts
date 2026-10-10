import { listDatesWithTasks, readTasks } from './tasks'
import { listJournalDates, readJournalDay, toPlainText } from './journal'
import { readTags } from './tags'
import type { SearchHit } from '../shared/types'

export type { SearchHit }

/** 单次检索返回的最大条数 */
const MAX_HITS = 50

/**
 * 检索任务：标题 / 正文 / 子任务标题 / 标签名（匹配标签名即命中使用该标签的任务）。
 *
 * 性能与语义：命中满 MAX_HITS 条立即停止扫描（不再遍历剩余天文件）；
 * 之所以从**最新日期往前**遍历，是为了让结果天然按日期倒序，
 * 避免"先正序收集全部命中再 reverse"造成无谓的全库扫描与内存占用。
 */
export async function searchTasks(
  root: string,
  query: string
): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []

  // 先找名字匹配的标签 id
  const tags = await readTags(root)
  const matchedTagIds = tags.filter((t) => t.name.toLowerCase().includes(q)).map((t) => t.id)

  const dates = await listDatesWithTasks(root)
  const hits: SearchHit[] = []

  outer: for (let i = dates.length - 1; i >= 0; i--) {
    const date = dates[i]
    const tasks = await readTasks(root, date)
    for (const t of tasks) {
      const plainBody = t.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
      const lowerBody = plainBody.toLowerCase()
      const inTitle = t.title.toLowerCase().includes(q)
      const inSubtask = (t.subtasks ?? []).some((st) => st.title.toLowerCase().includes(q))
      const tagHit =
        matchedTagIds.length > 0 &&
        (t.tags.some((id) => matchedTagIds.includes(id)) ||
          (t.subtasks ?? []).some((st) => st.tags.some((id) => matchedTagIds.includes(id))))
      const bodyIdx = lowerBody.indexOf(q)
      if (!inTitle && !inSubtask && !tagHit && bodyIdx === -1) continue

      let snippet = ''
      if (bodyIdx !== -1) {
        const start = Math.max(0, bodyIdx - 30)
        const end = Math.min(plainBody.length, bodyIdx + q.length + 30)
        snippet = plainBody.slice(start, end)
        if (start > 0) snippet = '…' + snippet
        if (end < plainBody.length) snippet = snippet + '…'
      } else if (inSubtask) {
        snippet = (t.subtasks ?? [])
          .map((st) => st.title)
          .filter((s) => s.toLowerCase().includes(q))
          .join('、')
      } else if (tagHit) {
        const names = matchedTagIds
          .map((id) => tags.find((x) => x.id === id)?.name)
          .filter(Boolean)
        snippet = `标签：${names.join('、')}`
      } else {
        snippet = plainBody.slice(0, 60)
        if (plainBody.length > 60) snippet += '…'
      }
      hits.push({ date, kind: 'task', taskId: t.id, title: t.title, snippet: snippet.trim() })
      if (hits.length >= MAX_HITS) break outer
    }
  }

  return hits
}

/**
 * 检索日志：整篇正文（纯文本化后）/ 挂载的任务标题。
 *
 * 与 `searchTasks` 同样的策略：从最新日期往前遍历、命中满 MAX_HITS 即停。
 */
export async function searchJournal(root: string, query: string): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const dates = await listJournalDates(root)
  const hits: SearchHit[] = []

  outer: for (let i = dates.length - 1; i >= 0; i--) {
    const date = dates[i]
    const day = await readJournalDay(root, date)
    if (!day) continue
    const plain = toPlainText(day.body)
    const idx = plain.toLowerCase().indexOf(q)
    const inMount = day.mountedTasks.some((m) => m.title.toLowerCase().includes(q))
    if (idx === -1 && !inMount) continue

    let snippet = ''
    if (idx !== -1) {
      const start = Math.max(0, idx - 30)
      const end = Math.min(plain.length, idx + q.length + 30)
      snippet = plain.slice(start, end)
      if (start > 0) snippet = '…' + snippet
      if (end < plain.length) snippet = snippet + '…'
    } else {
      snippet = '挂载任务：' + day.mountedTasks.map((m) => m.title).join('、')
    }

    hits.push({
      date,
      kind: 'journal',
      taskId: '',
      title: '日志',
      snippet: snippet.trim()
    })
    if (hits.length >= MAX_HITS) break outer
  }

  return hits
}

/**
 * 统一检索任务与日志，按日期倒序合并后截断到 MAX_HITS。
 *
 * 两个来源各自已按「最新优先」并在满额时提前停止，这里只做归并。
 * 同一日期内先任务后日志（保持稳定顺序，便于阅读）。
 */
export async function searchAll(root: string, query: string): Promise<SearchHit[]> {
  const [tasks, journal] = await Promise.all([searchTasks(root, query), searchJournal(root, query)])
  const merged = [...tasks, ...journal]
  merged.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return merged.slice(0, MAX_HITS)
}
