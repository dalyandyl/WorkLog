import type { MonthStats, Tag, Task } from '../types'
import { enumerateDates, weekdayOf, weekInfoOf } from './date'

export type ReportGranularity = 'day' | 'week' | 'month' | 'year'

/** 按粒度 + 锚点日期展开成日期列表 */
export function expandReportDates(g: ReportGranularity, anchor: string): string[] {
  if (!anchor) return []
  if (g === 'day') return [anchor]
  if (g === 'week') {
    const wi = weekInfoOf(anchor)
    return enumerateDates(wi.start, wi.end)
  }
  if (g === 'month') {
    const y = Number(anchor.slice(0, 4))
    const m = Number(anchor.slice(5, 7))
    const last = new Date(y, m, 0).getDate()
    return enumerateDates(`${anchor.slice(0, 7)}-01`, `${anchor.slice(0, 7)}-${String(last).padStart(2, '0')}`)
  }
  // year
  const y = anchor.slice(0, 4)
  return enumerateDates(`${y}-01-01`, `${y}-12-31`)
}

/** 报表标题里的时间标签 */
export function reportRangeLabel(g: ReportGranularity, anchor: string, dates: string[]): string {
  if (dates.length === 0) return ''
  if (g === 'day') return anchor
  if (g === 'week') {
    const wi = weekInfoOf(anchor)
    return `${wi.weekKey}（${dates[0]} ~ ${dates[dates.length - 1]}）`
  }
  if (g === 'month') return `${anchor.slice(0, 7)}`
  return `${anchor.slice(0, 4)}`
}

const GRAN_LABEL: Record<ReportGranularity, string> = {
  day: '日',
  week: '周',
  month: '月',
  year: '年'
}

export type ReportPart = 'all' | 'summary' | 'detail'

export function buildReportMarkdown(
  g: ReportGranularity,
  anchor: string,
  dates: string[],
  stats: MonthStats,
  tasksByDate: Record<string, Task[]>,
  tags: Tag[],
  part: ReportPart = 'all'
): string {
  const tagMap = new Map(tags.map((t) => [t.id, t.name]))
  const rate = stats.totalTasks > 0 ? Math.round((stats.doneTasks / stats.totalTasks) * 100) : 0
  const lines: string[] = []

  lines.push(`# 日志报表（${GRAN_LABEL[g]}）${reportRangeLabel(g, anchor, dates)}`, '')

  if (part === 'all' || part === 'summary') {
    // ---- 统计汇总 ----
    lines.push('## 统计汇总', '')
    lines.push(`- 任务总数：**${stats.totalTasks}**`)
    lines.push(`- 已完成：**${stats.doneTasks}**`)
    lines.push(`- 未完成：**${stats.pendingTasks}**`)
    lines.push(`- 完成率：**${rate}%**`)
    lines.push(`- 记录天数：**${stats.daysWithTasks}** / ${stats.totalDays}`, '')

    if (stats.tagCounts.length > 0) {
      lines.push('### 标签分布', '')
      for (const t of stats.tagCounts) lines.push(`- ${t.name}：${t.count} 次`)
      lines.push('')
    }
  }

  if (part === 'all' || part === 'detail') {
    // ---- 任务明细 ----
    lines.push('## 任务明细', '')
    let any = false
    for (const date of dates) {
      const tasks = tasksByDate[date] ?? []
      if (tasks.length === 0) continue
      any = true
      lines.push(`### ${date} ${weekdayOf(date)}`, '')
      for (const t of tasks) {
        const tagStr = t.tags
          .map((id) => tagMap.get(id))
          .filter(Boolean)
          .map((n) => `\`#${n}\``)
          .join(' ')
        lines.push(`- [${t.done ? 'x' : ' '}] ${t.title}${tagStr ? ' ' + tagStr : ''}`)
        const timeParts = [`派发：${new Date(t.publishedAt).toLocaleString()}`]
        if (t.completedAt) timeParts.push(`完成：${new Date(t.completedAt).toLocaleString()}`)
        lines.push(`  > ${timeParts.join(' · ')}`)
        if (t.note && t.note.trim()) {
          lines.push(`  > 📝 备注：${t.note.trim()}`)
        }
        for (const st of t.subtasks ?? []) {
          lines.push(`    - [${st.done ? 'x' : ' '}] ${st.title}`)
        }
      }
      lines.push('')
      for (const t of tasks) {
        if (t.body && t.body.trim()) {
          lines.push(`**${t.title}**`, '', t.body.trim(), '')
        }
      }
    }
    if (!any) lines.push('（该时间段暂无任务记录）', '')
  }

  return lines.join('\n')
}
