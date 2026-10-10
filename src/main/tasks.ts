import { promises as fs } from 'fs'
import path from 'path'
import type { NewTaskInput, Task } from '../shared/types'
import { readJson, writeJson, removeFile, withDataLock } from './jsonStore'
import { dayFilePath } from './paths'
import {
  ensureTaskDates,
  indexAddTask,
  indexLookup,
  indexRemoveTask,
  invalidateDay,
  readDayFileRaw,
  resetTaskCache
} from './taskCache'

export type { NewTaskInput, Task }
export { dayFilePath, resetTaskCache }

/** 某天数据文件的顶层结构 */
interface DayFile {
  tasks: Task[]
}

/** 排序：未完成在前，同组内按 order */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    return a.order - b.order
  })
}

/**
 * 读取某天任务（已排序）。
 *
 * 读操作**不加写锁**：写入是「临时文件 + rename」的原子操作，
 * 因此读到的永远是某个完整版本，不会看到半个文件。
 * 解析结果按 mtime 缓存（见 taskCache），并在此处做**深拷贝**，
 * 保证调用方拿到的对象可以随意修改而不会污染缓存。
 */
export async function readTasks(root: string, date: string): Promise<Task[]> {
  const raw = await readDayFileRaw(root, date)
  // 兼容旧数据：补默认子任务数组、备注、派发/完成时间；数组字段必须拷贝
  const tasks = raw.map((t) => ({
    ...t,
    tags: Array.isArray(t.tags) ? [...t.tags] : [],
    subtasks: (Array.isArray(t.subtasks) ? t.subtasks : []).map((st) => ({
      ...st,
      tags: Array.isArray(st.tags) ? [...st.tags] : []
    })),
    note: typeof t.note === 'string' ? t.note : '',
    publishedAt: t.publishedAt || t.createdAt || new Date().toISOString(),
    completedAt: t.completedAt ?? (t.done ? t.updatedAt || t.createdAt : null)
  }))
  return sortTasks(tasks)
}

/** 写入某天任务；任务清空时删除该天文件 */
async function writeTasks(root: string, date: string, tasks: Task[]): Promise<void> {
  const file = dayFilePath(root, date)
  if (tasks.length === 0) {
    await removeFile(file)
  } else {
    await writeJson(file, { tasks })
  }
  invalidateDay(root, date)
}

export async function createTask(
  root: string,
  date: string,
  input: NewTaskInput
): Promise<Task> {
  return withDataLock(async () => {
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
      note: '',
      publishedAt: now,
      completedAt: null,
      order: maxOrder + 1,
      createdAt: now,
      updatedAt: now
    }
    tasks.push(task)
    await writeTasks(root, date, tasks)
    indexAddTask(task.id, [date])
    return task
  })
}

export async function updateTask(
  root: string,
  date: string,
  taskId: string,
  patch: Partial<
    Pick<Task, 'title' | 'tags' | 'done' | 'body' | 'subtasks' | 'note' | 'completedAt'>
  >
): Promise<Task | null> {
  return withDataLock(async () => {
    // 以指定日期上的任务为基准应用补丁
    const baseTasks = await readTasks(root, date)
    const task = baseTasks.find((t) => t.id === taskId)
    if (!task) return null
    if (patch.title !== undefined) task.title = patch.title.trim()
    if (patch.tags !== undefined) task.tags = [...patch.tags]
    if (patch.done !== undefined) {
      task.done = patch.done
      // 勾选完成时记录完成时间（勾选时刻）；取消完成时清空
      task.completedAt = patch.done ? new Date().toISOString() : null
    }
    if (patch.body !== undefined) task.body = patch.body
    if (patch.subtasks !== undefined) task.subtasks = patch.subtasks
    if (patch.note !== undefined) task.note = patch.note
    // 显式 completedAt 优先于 done 推导出的值（保持既有语义，放在最后覆盖）
    if (patch.completedAt !== undefined) task.completedAt = patch.completedAt
    task.updatedAt = new Date().toISOString()

    // 区间派发的任务同一 id 共享多天：同步更新所有包含该 id 的日期
    const targetDates = await datesOfTask(root, taskId)
    for (const d of targetDates) {
      const tasks = await readTasks(root, d)
      const idx = tasks.findIndex((t) => t.id === taskId)
      if (idx !== -1) {
        // 保留各天原有的 order（排序是当天独立的）
        tasks[idx] = { ...task, order: tasks[idx].order }
        await writeTasks(root, d, tasks)
      }
    }
    return task
  })
}

/** 全库扫描：真正逐个读文件找出包含该 id 的日期（索引未覆盖时的兜底路径） */
async function fullScanDatesOfTask(root: string, taskId: string): Promise<string[]> {
  const dates = await listDatesWithTasks(root)
  const result: string[] = []
  for (const d of dates) {
    const tasks = await readTasks(root, d)
    if (tasks.some((t) => t.id === taskId)) result.push(d)
  }
  return result
}

/**
 * 找出所有包含指定任务 id 的日期（区间共享任务会出现在多天）。
 *
 * 优先走「任务 → 日期」索引（O(1)）；索引里查不到时才回退全库扫描，
 * 并把扫描结果回填索引 —— 因此索引的不完整不会导致漏同步。
 */
export async function datesOfTask(root: string, taskId: string): Promise<string[]> {
  await ensureTaskDates(root, () => listDatesWithTasks(root))
  const cached = indexLookup(taskId)
  if (cached && cached.length > 0) return cached
  const dates = await fullScanDatesOfTask(root, taskId)
  if (dates.length > 0) indexAddTask(taskId, dates)
  return dates
}

export async function deleteTask(
  root: string,
  date: string,
  taskId: string
): Promise<{ ok: boolean }> {
  return withDataLock(async () => {
    // 从所有包含该 id 的日期中删除（共享任务）
    const dates = await datesOfTask(root, taskId)
    let found = false
    for (const d of dates) {
      const tasks = await readTasks(root, d)
      const next = tasks.filter((t) => t.id !== taskId)
      if (next.length !== tasks.length) {
        found = true
        await writeTasks(root, d, next)
      }
    }
    indexRemoveTask(taskId)
    return { ok: found }
  })
}

/** 按界面给出的可见顺序重排 order（未完成在上、已完成在下的顺序） */
export async function reorderTasks(
  root: string,
  date: string,
  orderedIds: string[]
): Promise<void> {
  await withDataLock(async () => {
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
  })
}

/** 扫描所有有任务的日期（升序） */
export async function listDatesWithTasks(root: string): Promise<string[]> {
  const dates: string[] = []
  try {
    const years = await fs.readdir(root, { withFileTypes: true })
    for (const y of years) {
      if (!y.isDirectory()) continue
      // 只认 4 位年份目录。根目录下还有 journal / meetings / weekly / attachments 等
      // 非年份目录；不加这个约束时，`journal/<年>/<日期>.json` 这类三层布局
      // 一旦将来多一层或少一层，就会被误判成任务天文件而污染日历打点。
      if (!/^\d{4}$/.test(y.name)) continue
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

/**
 * 任务发布：区间派发时同一任务 id 写入所选每个日期（共享状态）。
 * 任一日期勾选完成 / 编辑 / 备注都会通过 updateTask 同步到所有天。
 */
export async function publishTasks(
  root: string,
  dates: string[],
  input: NewTaskInput
): Promise<{ count: number; instances: { date: string; taskId: string }[] }> {
  return withDataLock(async () => {
    const taskId = crypto.randomUUID()
    const now = new Date().toISOString()
    const task: Task = {
      id: taskId,
      title: input.title.trim(),
      tags: [...(input.tags ?? [])],
      done: false,
      body: input.body ?? '',
      subtasks: (input.subtasks ?? []).map((s) => ({
        id: s.id || crypto.randomUUID(),
        title: s.title,
        done: !!s.done,
        tags: [...(s.tags ?? [])]
      })),
      note: '',
      publishedAt: now,
      completedAt: null,
      order: 0,
      createdAt: now,
      updatedAt: now
    }
    const instances: { date: string; taskId: string }[] = []
    for (const d of dates) {
      const tasks = await readTasks(root, d)
      const maxOrder = tasks.reduce((m, t) => Math.max(m, t.order), -1)
      await writeTasks(root, d, [...tasks, { ...task, order: maxOrder + 1 }])
      instances.push({ date: d, taskId })
    }
    indexAddTask(taskId, dates)
    return { count: instances.length, instances }
  })
}

/** 恢复回收站任务实例到各自日期 */
export async function restoreTasksToDays(
  root: string,
  entries: { date: string; task: Task }[]
): Promise<void> {
  await withDataLock(async () => {
    const seen = new Set<string>()
    for (const { date, task } of entries) {
      // 同一任务跨天有多份副本，恢复时按 id 去重，避免重复恢复产生同 id 重复项
      const key = `${date}::${task.id}`
      if (seen.has(key)) continue
      seen.add(key)
      const tasks = await readTasks(root, date)
      // 该 id 已存在（例如上一次恢复成功但未从回收站移除）则跳过，不制造重复
      if (tasks.some((t) => t.id === task.id)) continue
      const maxOrder = tasks.reduce((m, t) => Math.max(m, t.order), -1)
      tasks.push({ ...task, order: maxOrder + 1 })
      await writeTasks(root, date, tasks)
      indexAddTask(task.id, [date])
    }
  })
}

/**
 * 任务延期：在原发布区间基础上「追加」自定义新区间。
 * 新区间每个日期写入同一条任务 id（已含该 id 的日期自动跳过），
 * 任一天勾选完成 / 编辑 / 备注继续按 id 全局同步（复用 updateTask 机制）。
 * 仅未完成任务可延期。
 */
export async function postponeTask(
  root: string,
  date: string,
  taskId: string,
  newDates: string[]
): Promise<{ ok: boolean; added: number }> {
  return withDataLock(async () => {
    const tasks = await readTasks(root, date)
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return { ok: false, added: 0 }
    if (task.done) return { ok: false, added: 0 }

    const existing = new Set(await datesOfTask(root, taskId))
    const addedDates: string[] = []
    for (const d of newDates) {
      if (existing.has(d)) continue // 与已有日期重叠的部分自动跳过
      const dayTasks = await readTasks(root, d)
      const maxOrder = dayTasks.reduce((m, t) => Math.max(m, t.order), -1)
      await writeTasks(root, d, [...dayTasks, { ...task, order: maxOrder + 1 }])
      existing.add(d)
      addedDates.push(d)
    }
    if (addedDates.length > 0) indexAddTask(taskId, addedDates)
    return { ok: true, added: addedDates.length }
  })
}

/** 从所有任务（含子任务）中移除某标签引用（标签删除时联动） */
export async function removeTagFromAllTasks(root: string, tagId: string): Promise<void> {
  await withDataLock(async () => {
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
  })
}
