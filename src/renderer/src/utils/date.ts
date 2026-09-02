/** Date -> 'YYYY-MM-DD' */
export function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 'YYYY-MM-DD' -> 星期几（中文） */
export function weekdayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return names[d.getDay()]
}

export interface WeekInfo {
  year: number
  week: number
  weekKey: string
  start: string
  end: string
}

/** 计算某日期所在 ISO 周（周一起始），与主进程 storage.getWeekInfo 保持一致 */
export function weekInfoOf(dateStr: string): WeekInfo {
  const d = new Date(dateStr + 'T00:00:00')
  const dow = (d.getDay() + 6) % 7
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow)
  const thursday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3)
  const isoYear = thursday.getFullYear()
  const dayOfYear = Math.floor(
    (thursday.getTime() - new Date(isoYear, 0, 1).getTime()) / 86400000
  )
  const week = Math.floor(dayOfYear / 7) + 1
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
  return {
    year: isoYear,
    week,
    weekKey: `${isoYear}-W${String(week).padStart(2, '0')}`,
    start: toDateStr(monday),
    end: toDateStr(sunday)
  }
}

/** 枚举 start~end（含端点）之间的所有日期 */
export function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = []
  const d = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  while (d.getTime() <= e.getTime()) {
    dates.push(toDateStr(d))
    d.setDate(d.getDate() + 1)
  }
  return dates
}

export type PublishGranularity = 'day' | 'week' | 'month' | 'year'

/**
 * 按粒度在区间内生成目标日期：
 * - day：每天
 * - week：从 start 所在周的周一起，每周一次
 * - month：从 start 年月起，每月与 start 同日（不足则取月末）
 * - year：从 start 年起，每年同月同日
 */
export function datesByGranularity(
  start: string,
  end: string,
  g: PublishGranularity
): string[] {
  if (!start || !end || end < start) return []
  const out: string[] = []
  const sd = new Date(start + 'T00:00:00')
  const endTime = new Date(end + 'T00:00:00').getTime()

  if (g === 'day') return enumerateDates(start, end)

  if (g === 'week') {
    const dow = (sd.getDay() + 6) % 7
    const cur = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate() - dow)
    while (cur.getTime() <= endTime) {
      out.push(toDateStr(cur))
      cur.setDate(cur.getDate() + 7)
    }
    return out
  }

  if (g === 'month') {
    const day = sd.getDate()
    let y = sd.getFullYear()
    let m = sd.getMonth()
    while (true) {
      const lastDay = new Date(y, m + 1, 0).getDate()
      const cur = new Date(y, m, Math.min(day, lastDay))
      if (cur.getTime() > endTime) break
      out.push(toDateStr(cur))
      m++
      if (m > 11) {
        m = 0
        y++
      }
    }
    return out
  }

  // year
  const day = sd.getDate()
  const mon = sd.getMonth()
  let y = sd.getFullYear()
  while (true) {
    const lastDay = new Date(y, mon + 1, 0).getDate()
    const cur = new Date(y, mon, Math.min(day, lastDay))
    if (cur.getTime() > endTime) break
    out.push(toDateStr(cur))
    y++
  }
  return out
}
