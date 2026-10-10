import type { StickyNote } from '../shared/types'
import { readJson, writeJson, withDataLock } from './jsonStore'
import { stickyNotesPath } from './paths'

function notesPath(root: string): string {
  return stickyNotesPath(root)
}

function normalize(n: StickyNote): StickyNote {
  return {
    id: n.id,
    text: n.text ?? '',
    pinned: n.pinned === true,
    completed: n.completed === true,
    createdAt: n.createdAt ?? new Date().toISOString(),
    completedAt: n.completedAt ?? null
  }
}

/** 读取全部便签（按创建时间倒序，最新在前） */
export async function listStickyNotes(root: string): Promise<StickyNote[]> {
  const all = await readJson<StickyNote[]>(notesPath(root), [])
  const notes = (Array.isArray(all) ? all : []).map(normalize)
  notes.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  return notes
}

/** 新增便签（默认置顶，立即出现在日报） */
export function addStickyNote(root: string, text: string): Promise<StickyNote> {
  return withDataLock(async () => {
    const all = await readJson<StickyNote[]>(notesPath(root), [])
    const note: StickyNote = {
      id: crypto.randomUUID(),
      text: text.trim(),
      pinned: true,
      completed: false,
      createdAt: new Date().toISOString(),
      completedAt: null
    }
    all.push(note)
    await writeJson(notesPath(root), all)
    return note
  })
}

/** 更新便签（text / pinned / completed；标记完成自动记 completedAt，取消完成清空） */
export function updateStickyNote(
  root: string,
  id: string,
  patch: Partial<Pick<StickyNote, 'text' | 'pinned' | 'completed'>>
): Promise<StickyNote | null> {
  return withDataLock(async () => {
    const all = await readJson<StickyNote[]>(notesPath(root), [])
    const list = Array.isArray(all) ? all : []
    const note = list.find((n) => n.id === id)
    if (!note) return null
    if (patch.text !== undefined) note.text = patch.text.trim()
    if (patch.pinned !== undefined) note.pinned = patch.pinned
    if (patch.completed !== undefined) {
      note.completed = patch.completed
      note.completedAt = patch.completed ? new Date().toISOString() : null
    }
    await writeJson(notesPath(root), list)
    return normalize(note)
  })
}

/** 删除便签（彻底删除，不进回收站） */
export function deleteStickyNote(root: string, id: string): Promise<{ ok: boolean }> {
  return withDataLock(async () => {
    const all = await readJson<StickyNote[]>(notesPath(root), [])
    const list = Array.isArray(all) ? all : []
    const next = list.filter((n) => n.id !== id)
    if (next.length === list.length) return { ok: false }
    await writeJson(notesPath(root), next)
    return { ok: true }
  })
}
