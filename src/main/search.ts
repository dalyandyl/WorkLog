import { listDatesWithTasks, readTasks } from './tasks'
import { readTags } from './tags'
import type { SearchHit } from '../shared/types'

export type { SearchHit }

/**
 * 检索任务：标题 / 正文 / 子任务标题 / 标签名（匹配标签名即命中使用该标签的任务）。
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

  for (const date of dates) {
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
      snippet = snippet.trim()
      hits.push({ date, taskId: t.id, title: t.title, snippet })
      if (hits.length >= 50) {
        hits.splice(0, hits.length - 50)
      }
    }
  }

  hits.reverse()
  return hits.slice(0, 50)
}
