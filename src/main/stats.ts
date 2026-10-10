import { readTasks } from './tasks'
import { readTags, type Tag } from './tags'
import { enumerateDates } from './storage'
import type { MonthStats, TagCount } from '../shared/types'

export type { MonthStats, TagCount }

/**
 * 统计 start~end（含端点）区间内的任务情况
 * （MonthStats 结构复用，year/month 为区间起始年月）。
 *
 * 两个口径约定（与标签页的 useCount 保持一致，见 memory-bank/03-data-model.md §4）：
 *   - `totalTasks` / `doneTasks` / `pendingTasks` **按任务 id 去重**：
 *     区间派发/延期的任务会在多天各存一份副本，按天累加会把一个任务算成 N 个；
 *   - `tagCounts` **同时统计子任务标签**（此前只统计任务级标签，与标签页口径不一致）。
 *   - `daily[]` 仍是**逐日**的出现次数（那是"当天有几个任务"的语义，不应去重）。
 */
export async function rangeStats(
  root: string,
  start: string,
  end: string
): Promise<MonthStats> {
  const dates = enumerateDates(start, end)

  const tags: Tag[] = await readTags(root)
  const tagMap = new Map(tags.map((t) => [t.id, t]))

  /** 已计入总数的任务 id（跨天去重） */
  const seenTaskIds = new Set<string>()
  let totalTasks = 0
  let doneTasks = 0
  let daysWithTasks = 0
  const tagCountMap = new Map<string, number>()
  const daily: { date: string; day: number; taskCount: number; doneCount: number }[] = []

  const bumpTag = (tagId: string): void => {
    tagCountMap.set(tagId, (tagCountMap.get(tagId) ?? 0) + 1)
  }

  for (const date of dates) {
    const tasks = await readTasks(root, date)
    const day = Number(date.slice(8, 10))
    const taskCount = tasks.length
    const doneCount = tasks.filter((t) => t.done).length
    daily.push({ date, day, taskCount, doneCount })
    if (taskCount === 0) continue

    daysWithTasks++
    for (const t of tasks) {
      // 跨天共享任务只计一次
      if (!seenTaskIds.has(t.id)) {
        seenTaskIds.add(t.id)
        totalTasks++
        if (t.done) doneTasks++
      }
      // 标签用量：任务级 + 子任务级（与 tags.ts 的 useCount 口径一致）
      for (const tagId of t.tags) bumpTag(tagId)
      for (const st of t.subtasks ?? []) {
        for (const tagId of st.tags) bumpTag(tagId)
      }
    }
  }

  const tagCounts: TagCount[] = [...tagCountMap.entries()]
    .map(([tagId, count]) => {
      const t = tagMap.get(tagId)
      return { tagId, name: t?.name ?? '（已删除标签）', color: t?.color ?? '#999999', count }
    })
    .sort((a, b) => b.count - a.count)

  return {
    year: Number(start.slice(0, 4)),
    month: Number(start.slice(5, 7)),
    totalDays: dates.length,
    daysWithTasks,
    totalTasks,
    doneTasks,
    pendingTasks: totalTasks - doneTasks,
    tagCounts,
    daily
  }
}
