import { readTasks } from './tasks'
import { readTags, type Tag } from './tags'
import { enumerateDates } from './storage'
import type { MonthStats, TagCount } from '../shared/types'

export type { MonthStats, TagCount }

/** 统计 start~end（含端点）区间内的任务情况（MonthStats 结构复用，year/month 为区间起始年月） */
export async function rangeStats(
  root: string,
  start: string,
  end: string,
  projectId?: string
): Promise<MonthStats> {
  const dates = enumerateDates(start, end)

  const tags: Tag[] = await readTags(root)
  const tagMap = new Map(tags.map((t) => [t.id, t]))

  let totalTasks = 0
  let doneTasks = 0
  let daysWithTasks = 0
  const tagCountMap = new Map<string, number>()
  const daily: { date: string; day: number; taskCount: number; doneCount: number }[] = []

  for (const date of dates) {
    const all = await readTasks(root, date)
    const tasks = projectId ? all.filter((t) => t.projectId === projectId) : all
    const day = Number(date.slice(8, 10))
    const taskCount = tasks.length
    const doneCount = tasks.filter((t) => t.done).length
    daily.push({ date, day, taskCount, doneCount })
    if (taskCount === 0) continue

    daysWithTasks++
    totalTasks += taskCount
    doneTasks += doneCount
    for (const t of tasks) {
      for (const tagId of t.tags) {
        tagCountMap.set(tagId, (tagCountMap.get(tagId) ?? 0) + 1)
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
