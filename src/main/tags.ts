import { promises as fs } from 'fs'
import path from 'path'
import type { Tag } from '../shared/types'
import { listDatesWithTasks, readTasks, removeTagFromAllTasks } from './tasks'

export type { Tag }

export function tagsPath(root: string): string {
  return path.join(root, 'tags.json')
}

export async function readTags(root: string): Promise<Tag[]> {
  try {
    const raw = await fs.readFile(tagsPath(root), 'utf-8')
    const data = JSON.parse(raw)
    const tags = Array.isArray(data) ? (data as Tag[]) : []
    // 兼容旧数据：补 createdAt
    return tags.map((t) => ({ ...t, createdAt: t.createdAt || new Date(0).toISOString() }))
  } catch {
    return []
  }
}

async function writeTags(root: string, tags: Tag[]): Promise<void> {
  await fs.mkdir(path.dirname(tagsPath(root)), { recursive: true })
  await fs.writeFile(tagsPath(root), JSON.stringify(tags, null, 2), 'utf-8')
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
  const tags = await readTags(root)
  const n = name.trim()
  if (tags.some((t) => t.name === n)) return null // 不允许重名
  const tag: Tag = { id: crypto.randomUUID(), name: n, color, createdAt: new Date().toISOString() }
  tags.push(tag)
  await writeTags(root, tags)
  return tag
}

/** 重命名：任务里存的是标签 id，改名自动生效；不允许与其他标签重名 */
export async function renameTag(
  root: string,
  id: string,
  name: string
): Promise<Tag | null> {
  const tags = await readTags(root)
  const tag = tags.find((t) => t.id === id)
  if (!tag) return null
  const n = name.trim()
  if (tags.some((t) => t.id !== id && t.name === n)) return null
  tag.name = n
  await writeTags(root, tags)
  return tag
}

export async function recolorTag(
  root: string,
  id: string,
  color: string
): Promise<Tag | null> {
  const tags = await readTags(root)
  const tag = tags.find((t) => t.id === id)
  if (!tag) return null
  tag.color = color
  await writeTags(root, tags)
  return tag
}

/** 删除标签：同时从所有任务的标签引用中移除 */
export async function deleteTag(root: string, id: string): Promise<{ ok: boolean }> {
  const tags = await readTags(root)
  const next = tags.filter((t) => t.id !== id)
  if (next.length === tags.length) return { ok: false }
  await writeTags(root, next)
  await removeTagFromAllTasks(root, id)
  return { ok: true }
}
