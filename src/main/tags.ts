import type { Tag } from '../shared/types'
import { listDatesWithTasks, readTasks, removeTagFromAllTasks } from './tasks'
import { readJson, writeJson, withDataLock } from './jsonStore'
import { tagsPath } from './paths'

export type { Tag }
export { tagsPath }

/**
 * 读取标签库。
 * 损坏/截断的 tags.json 会被隔离备份并由 jsonStore 发告警，而不是静默当空。
 */
export async function readTags(root: string): Promise<Tag[]> {
  const data = await readJson<unknown>(tagsPath(root), [])
  const tags = Array.isArray(data) ? (data as Tag[]) : []
  // 兼容旧数据：补 createdAt
  return tags.map((t) => ({ ...t, createdAt: t.createdAt || new Date(0).toISOString() }))
}

async function writeTags(root: string, tags: Tag[]): Promise<void> {
  await writeJson(tagsPath(root), tags)
}

/** 统计每个标签在任务与子任务中的使用次数 */
async function countTagUsage(root: string): Promise<Map<string, number>> {
  const count = new Map<string, number>()
  const dates = await listDatesWithTasks(root)
  for (const d of dates) {
    const tasks = await readTasks(root, d)
    for (const t of tasks) {
      for (const tagId of t.tags) count.set(tagId, (count.get(tagId) ?? 0) + 1)
      for (const st of t.subtasks ?? []) {
        for (const tagId of st.tags) count.set(tagId, (count.get(tagId) ?? 0) + 1)
      }
    }
  }
  return count
}

export async function listTags(root: string): Promise<Tag[]> {
  const tags = await readTags(root)
  const usage = await countTagUsage(root)
  return tags
    .map((t) => ({ ...t, useCount: usage.get(t.id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

export async function createTag(root: string, name: string, color: string): Promise<Tag | null> {
  return withDataLock(async () => {
    const tags = await readTags(root)
    const n = name.trim()
    if (tags.some((t) => t.name === n)) return null // 不允许重名
    const tag: Tag = {
      id: crypto.randomUUID(),
      name: n,
      color,
      createdAt: new Date().toISOString()
    }
    tags.push(tag)
    await writeTags(root, tags)
    return tag
  })
}

/** 重命名：任务里存的是标签 id，改名自动生效；不允许与其他标签重名 */
export async function renameTag(
  root: string,
  id: string,
  name: string
): Promise<Tag | null> {
  return withDataLock(async () => {
    const tags = await readTags(root)
    const tag = tags.find((t) => t.id === id)
    if (!tag) return null
    const n = name.trim()
    if (tags.some((t) => t.id !== id && t.name === n)) return null
    tag.name = n
    await writeTags(root, tags)
    return tag
  })
}

export async function recolorTag(
  root: string,
  id: string,
  color: string
): Promise<Tag | null> {
  return withDataLock(async () => {
    const tags = await readTags(root)
    const tag = tags.find((t) => t.id === id)
    if (!tag) return null
    tag.color = color
    await writeTags(root, tags)
    return tag
  })
}

/**
 * 删除标签：同时从所有任务的标签引用中移除。
 *
 * 注意：**不能**把两步包在同一个 withDataLock 里 —— 写锁不可重入，
 * `removeTagFromAllTasks` 内部自己会加锁，嵌套会死锁。两步各自加锁即可：
 * 即便中间失败，最坏结果是留下无害的孤儿标签引用（界面上不显示标签名）。
 */
export async function deleteTag(root: string, id: string): Promise<{ ok: boolean }> {
  const removed = await withDataLock(async () => {
    const tags = await readTags(root)
    const next = tags.filter((t) => t.id !== id)
    if (next.length === tags.length) return false
    await writeTags(root, next)
    return true
  })
  if (!removed) return { ok: false }
  await removeTagFromAllTasks(root, id)
  return { ok: true }
}
