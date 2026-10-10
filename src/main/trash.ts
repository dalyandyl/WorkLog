import type { JournalEntry, PublishRecord, TrashItem, TrashedTask } from '../shared/types'
import { readJson, writeJson, withDataLock, reportDataWarning } from './jsonStore'
import { trashPath } from './paths'
import { datesOfTask, readTasks, restoreTasksToDays } from './tasks'
import { saveJournalEntry } from './journal'

export { trashPath }

interface TrashFile {
  items: TrashItem[]
}

/** 回收站保留的最大条目数（安全阀，非常规清理） */
const MAX_TRASH_ITEMS = 500

/**
 * 读取回收站条目（不排序）。
 * 损坏/截断的 trash.json 会被隔离备份并由 jsonStore 发告警，而不是静默当空。
 */
export async function readTrash(root: string): Promise<TrashItem[]> {
  const data = await readJson<TrashFile>(trashPath(root), { items: [] })
  return Array.isArray(data?.items) ? data.items : []
}

/** 写入回收站条目；超过上限时保留最新的 MAX_TRASH_ITEMS 条，并告知用户 */
async function writeTrash(root: string, items: TrashItem[]): Promise<void> {
  let next = items
  if (items.length > MAX_TRASH_ITEMS) {
    next = items.slice(0, MAX_TRASH_ITEMS)
    const dropped = items.length - next.length
    // 刻意不静默丢弃：通过数据层告警通道告知用户
    reportDataWarning({
      kind: 'corrupt',
      file: trashPath(root),
      message: `回收站条目超过 ${MAX_TRASH_ITEMS} 条上限，已清理最早的 ${dropped} 条`
    })
  }
  await writeJson(trashPath(root), { items: next })
}

export async function listTrash(root: string): Promise<TrashItem[]> {
  const items = await readTrash(root)
  return [...items].sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1))
}

export async function addTrashItem(root: string, item: TrashItem): Promise<void> {
  await withDataLock(async () => {
    const items = await readTrash(root)
    items.unshift(item)
    await writeTrash(root, items)
  })
}

/** 按 id 查找回收站条目（不修改文件）——恢复流程应先重放成功再删除 */
export async function findTrashItem(root: string, id: string): Promise<TrashItem | null> {
  const items = await readTrash(root)
  return items.find((i) => i.id === id) ?? null
}

/** 永久删除回收站条目 */
export async function removeTrashItem(root: string, id: string): Promise<{ ok: boolean }> {
  return withDataLock(async () => {
    const items = await readTrash(root)
    const next = items.filter((i) => i.id !== id)
    if (next.length === items.length) return { ok: false }
    await writeTrash(root, next)
    return { ok: true }
  })
}

export async function clearTrash(root: string): Promise<void> {
  await withDataLock(async () => {
    await writeTrash(root, [])
  })
}

// ==================== 快照组装 ====================

/**
 * 把某个任务（含其跨天的全部副本）快照进回收站。
 *
 * 这段"如何组装一个回收站条目"的逻辑原先只存在于 IPC 层，
 * 无法被复用也无法单测；现在下沉到这里（见 memory-bank/07-optimization-backlog.md P2-4）。
 *
 * 注意：本函数**不**持有写锁（`addTrashItem` 自己会加），符合"组合函数不持锁"的约定。
 * 删除任务由调用方负责（先快照、后删除，保证失败时不丢数据）。
 */
export async function snapshotTaskToTrash(
  root: string,
  taskId: string
): Promise<{ ok: boolean; count: number }> {
  const dates = await datesOfTask(root, taskId)
  const tasks: TrashedTask[] = []
  for (const d of dates) {
    const dayTasks = await readTasks(root, d)
    const task = dayTasks.find((t) => t.id === taskId)
    if (task) tasks.push({ date: d, task })
  }
  if (tasks.length === 0) return { ok: false, count: 0 }
  await addTrashItem(root, {
    id: crypto.randomUUID(),
    title: tasks[0].task.title || '未命名任务',
    deletedAt: new Date().toISOString(),
    tasks
  })
  return { ok: true, count: tasks.length }
}

/** 一次回收涉及的任务 id（去重后） */
export interface SnapshotResult {
  ok: boolean
  /** 被快照的任务 id（调用方据此删除任务） */
  taskIds: string[]
  /** 实际快照的实例条数 */
  count: number
}

/**
 * 把一条日志条目快照进回收站。
 *
 * 与 `snapshotTaskToTrash` 同样**不持有写锁**（`addTrashItem` 自己会加）：
 * 调用方负责「先快照、后删除」，保证删除失败或崩溃时不丢数据。
 * `tasks` 写空数组（而非 undefined），让回收站详情能无脑遍历。
 */
export async function snapshotJournalEntryToTrash(
  root: string,
  date: string,
  entry: JournalEntry
): Promise<{ ok: boolean }> {
  await addTrashItem(root, {
    id: crypto.randomUUID(),
    title: `日志 ${date}${entry.time ? ' ' + entry.time : ''}`,
    deletedAt: new Date().toISOString(),
    tasks: [],
    journal: { date, entry }
  })
  return { ok: true }
}

/**
 * 从回收站恢复一个条目（任务或日志）。
 *
 * **先重放成功、再移出回收站** —— 旧实现「取出即移除」会在重放失败时永久丢数据。
 * 从 IPC 层下沉到这里，既与 `snapshotTaskToTrash` 对称，也让它能被 `test:data` 覆盖。
 *
 * 注意本函数**不持仓写锁**地串联多个各自加锁的步骤（`saveJournalEntry` / `restoreTasksToDays`
 * / `removeTrashItem` 各自加锁），符合「组合函数不持锁」的约定；失败会在中途抛出，
 * 此时条目仍留在回收站里，数据不丢。
 */
export async function restoreTrashItem(root: string, id: string): Promise<{ ok: boolean }> {
  const item = await findTrashItem(root, id)
  if (!item) return { ok: false }

  if (item.journal) {
    // 日志：按快照里的日期与 id 重新写入（saveJournalEntry 是按 id upsert，天然幂等）
    await saveJournalEntry(root, item.journal.date, item.journal.entry)
  } else {
    // 任务：兜底 tasks 可能缺失/非数组（半损坏的 trash.json），避免直接 .map 抛错
    const trashed = Array.isArray(item.tasks) ? item.tasks : []
    await restoreTasksToDays(
      root,
      trashed.map((t) => ({ date: t.date, task: t.task }))
    )
  }

  await removeTrashItem(root, id)
  return { ok: true }
}

/**
 * 把一条发布记录涉及的**整批任务实例**快照进回收站。
 * 区间共享任务同一 id 跨多天，按 id 去重后再逐个收集全部日期。
 */
export async function snapshotPublishRecordToTrash(
  root: string,
  record: PublishRecord
): Promise<SnapshotResult> {
  const taskIds: string[] = []
  const seen = new Set<string>()
  const tasks: TrashedTask[] = []

  for (const inst of record.instances ?? []) {
    if (seen.has(inst.taskId)) continue
    seen.add(inst.taskId)
    taskIds.push(inst.taskId)
    const dates = await datesOfTask(root, inst.taskId)
    for (const d of dates) {
      const dayTasks = await readTasks(root, d)
      const task = dayTasks.find((t) => t.id === inst.taskId)
      if (task) tasks.push({ date: d, task })
    }
  }

  if (tasks.length === 0) return { ok: false, taskIds, count: 0 }
  await addTrashItem(root, {
    id: crypto.randomUUID(),
    title: record.title || '未命名任务',
    deletedAt: new Date().toISOString(),
    tasks
  })
  return { ok: true, taskIds, count: tasks.length }
}
