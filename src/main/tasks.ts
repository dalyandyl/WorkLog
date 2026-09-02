import { promises as fs } from 'fs'
import path from 'path'
import type { NewTaskInput, Task } from '../shared/types'
import { UNCATEGORIZED_ID } from './projects'

export type { NewTaskInput, Task }

export function dayFilePath(root: string, date: string): string {
  const year = date.slice(0, 4)
  return path.join(root, year, `${date}.json`)
}

/** 排序：未完成在前，同组内按 order */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    return a.order - b.order
  })
}

export async function readTasks(root: string, date: string): Promise<Task[]> {
  try {
    const raw = await fs.readFile(dayFilePath(root, date), 'utf-8')
    const data = JSON.parse(raw)
    const rawTasks = Array.isArray(data?.tasks) ? (data.tasks as Task[]) : []
    // 兼容旧数据：补默认子任务数组、项目、派发/完成时间
    const tasks = rawTasks.map((t) => ({
      ...t,
      subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
      projectId: t.projectId || UNCATEGORIZED_ID,
      publishedAt: t.publishedAt || t.createdAt || new Date().toISOString(),
      completedAt: t.completedAt ?? (t.done ? (t.updatedAt || t.createdAt) : null)
    }))
    return sortTasks(tasks)
  } catch {
    return []
  }
}

async function writeTasks(root: string, date: string, tasks: Task[]): Promise<void> {
  const file = dayFilePath(root, date)
  if (tasks.length === 0) {
    await fs.rm(file, { force: true })
    return
  }
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify({ tasks }, null, 2), 'utf-8')
}

export async function createTask(
  root: string,
  date: string,
  input: NewTaskInput
): Promise<Task> {
  const tasks = await readTasks(root, date)
  const maxOrder = tasks.reduce((m, t) => Math.max(m, t.order), -1)
  const now = new Date().toISOString()
  const task: Task = {
    id: crypto.randomUUID(),
    title: input.title.trim(),
    tags: [...input.tags],
    done: false,
    body: input.body ?? '',
    subtasks: (input.subtasks ?? []).map((s) => ({
      id: s.id || crypto.randomUUID(),
      title: s.title,
      done: !!s.done,
      tags: [...(s.tags ?? [])]
    })),
    projectId: input.projectId || UNCATEGORIZED_ID,
    publishedAt: now,
    completedAt: null,
    order: maxOrder + 1,
    createdAt: now,
    updatedAt: now
  }
  tasks.push(task)
  await writeTasks(root, date, tasks)
  return task
}

export async function updateTask(
  root: string,
  date: string,
  taskId: string,
  patch: Partial<Pick<Task, 'title' | 'tags' | 'done' | 'body' | 'subtasks' | 'projectId' | 'completedAt'>>
): Promise<Task | null> {
  const tasks = await readTasks(root, date)
  const task = tasks.find((t) => t.id === taskId)
  if (!task) return null
  if (patch.title !== undefined) task.title = patch.title.trim()
  if (patch.tags !== undefined) task.tags = [...patch.tags]
  if (patch.done !== undefined) {
    task.done = patch.done
    // 勾选完成时记录完成时间；取消完成时清空
    if (patch.done) task.completedAt = new Date().toISOString()
    else task.completedAt = null
  }
  if (patch.body !== undefined) task.body = patch.body
  if (patch.subtasks !== undefined) task.subtasks = patch.subtasks
  if (patch.projectId !== undefined) task.projectId = patch.projectId
  if (patch.completedAt !== undefined) task.completedAt = patch.completedAt
  task.updatedAt = new Date().toISOString()
  await writeTasks(root, date, tasks)
  return task
}

export async function deleteTask(
  root: string,
  date: string,
  taskId: string
): Promise<{ ok: boolean }> {
  const tasks = await readTasks(root, date)
  const next = tasks.filter((t) => t.id !== taskId)
  if (next.length === tasks.length) return { ok: false }
  await writeTasks(root, date, next)
  return { ok: true }
}

/** 按界面给出的可见顺序重排 order（未完成在上、已完成在下的顺序） */
export async function reorderTasks(
  root: string,
  date: string,
  orderedIds: string[]
): Promise<void> {
  const tasks = await readTasks(root, date)
  const byId = new Map(tasks.map((t) => [t.id, t]))
  let order = 0
  for (const id of orderedIds) {
    const t = byId.get(id)
    if (t) {
      t.order = order
      order++
    }
  }
  await writeTasks(root, date, tasks)
}

/** 扫描所有有任务的日期（升序） */
export async function listDatesWithTasks(root: string): Promise<string[]> {
  const dates: string[] = []
  try {
    const years = await fs.readdir(root, { withFileTypes: true })
    for (const y of years) {
      if (!y.isDirectory()) continue
      const files = await fs.readdir(path.join(root, y.name))
      for (const f of files) {
        const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f)
        if (m) dates.push(m[1])
      }
    }
  } catch {
    // 目录不存在
  }
  dates.sort()
  return dates
}

/** 批量读取多天任务 */
export async function readTasksMany(
  root: string,
  dates: string[]
): Promise<Record<string, Task[]>> {
  const result: Record<string, Task[]> = {}
  for (const d of dates) {
    result[d] = await readTasks(root, d)
  }
  return result
}

/** 任务发布：把任务复制到所选日期 × 所选项目（每天每项目独立副本） */
export async function publishTasks(
  root: string,
  dates: string[],
  projectIds: string[],
  input: NewTaskInput
): Promise<{ count: number; instances: { date: string; projectId: string; taskId: string }[] }> {
  let count = 0
  const instances: { date: string; projectId: string; taskId: string }[] = []
  for (const d of dates) {
    for (const pid of projectIds) {
      const task = await createTask(root, d, { ...input, projectId: pid })
      instances.push({ date: d, projectId: pid, taskId: task.id })
      count++
    }
  }
  return { count, instances }
}

/** 恢复回收站任务实例到各自日期 */
export async function restoreTasksToDays(
  root: string,
  entries: { date: string; task: Task }[]
): Promise<void> {
  for (const { date, task } of entries) {
    const tasks = await readTasks(root, date)
    const maxOrder = tasks.reduce((m, t) => Math.max(m, t.order), -1)
    tasks.push({ ...task, order: maxOrder + 1 })
    await writeTasks(root, date, tasks)
  }
}

/** 从所有任务（含子任务）中移除某标签引用（标签删除时联动） */
export async function removeTagFromAllTasks(root: string, tagId: string): Promise<void> {
  const dates = await listDatesWithTasks(root)
  for (const d of dates) {
    const tasks = await readTasks(root, d)
    let changed = false
    for (const t of tasks) {
      if (t.tags.includes(tagId)) {
        t.tags = t.tags.filter((x) => x !== tagId)
        changed = true
      }
      if (Array.isArray(t.subtasks)) {
        for (const st of t.subtasks) {
          if (st.tags.includes(tagId)) {
            st.tags = st.tags.filter((x) => x !== tagId)
            changed = true
          }
        }
      }
    }
    if (changed) await writeTasks(root, d, tasks)
  }
}
