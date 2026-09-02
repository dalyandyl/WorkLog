import { promises as fs } from 'fs'
import path from 'path'
import type { TrashItem } from '../shared/types'

export function trashPath(root: string): string {
  return path.join(root, 'trash.json')
}

export async function readTrash(root: string): Promise<TrashItem[]> {
  try {
    const raw = await fs.readFile(trashPath(root), 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data?.items) ? (data.items as TrashItem[]) : []
  } catch {
    return []
  }
}

async function writeTrash(root: string, items: TrashItem[]): Promise<void> {
  await fs.mkdir(path.dirname(trashPath(root)), { recursive: true })
  await fs.writeFile(trashPath(root), JSON.stringify({ items }, null, 2), 'utf-8')
}

export async function listTrash(root: string): Promise<TrashItem[]> {
  const items = await readTrash(root)
  return items.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1))
}

export async function addTrashItem(root: string, item: TrashItem): Promise<void> {
  const items = await readTrash(root)
  items.unshift(item)
  await writeTrash(root, items)
}

/** 从回收站取出某条（用于恢复），返回取出的条目；不存在返回 null */
export async function takeTrashItem(root: string, id: string): Promise<TrashItem | null> {
  const items = await readTrash(root)
  const idx = items.findIndex((i) => i.id === id)
  if (idx === -1) return null
  const [item] = items.splice(idx, 1)
  await writeTrash(root, items)
  return item
}

/** 永久删除回收站条目 */
export async function removeTrashItem(root: string, id: string): Promise<{ ok: boolean }> {
  const items = await readTrash(root)
  const next = items.filter((i) => i.id !== id)
  if (next.length === items.length) return { ok: false }
  await writeTrash(root, next)
  return { ok: true }
}

export async function clearTrash(root: string): Promise<void> {
  await writeTrash(root, [])
}
