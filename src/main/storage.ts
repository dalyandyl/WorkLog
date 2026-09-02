import { app } from 'electron'
import path from 'path'
import type { WeekInfo } from '../shared/types'

export type { WeekInfo }

/**
 * 日志存储根目录。
 * 打包后：<安装目录>/logs（例如 D:\rizhi\logs）
 * 开发中：<项目目录>/logs
 */
export function getStorageRoot(): string {
  if (app.isPackaged) {
    return path.join(path.dirname(process.execPath), 'logs')
  }
  return path.join(app.getAppPath(), 'logs')
}

/** Date -> 'YYYY-MM-DD' */
export function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function weekdayName(dateStr: string): string {
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return names[new Date(dateStr + 'T00:00:00').getDay()]
}

/** 计算某日期所在 ISO 周的信息（周一起始） */
export function getWeekInfo(dateStr: string): WeekInfo {
  const d = new Date(dateStr + 'T00:00:00')
  const dow = (d.getDay() + 6) % 7 // 0 = 周一
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow)
  const thursday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3)
  const isoYear = thursday.getFullYear()
  const dayOfYear = Math.floor(
    (thursday.getTime() - new Date(isoYear, 0, 1).getTime()) / 86400000
  )
  const week = Math.floor(dayOfYear / 7) + 1

  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const dd = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
    dates.push(toDateStr(dd))
  }

  return {
    year: isoYear,
    week,
    weekKey: `${isoYear}-W${String(week).padStart(2, '0')}`,
    start: toDateStr(monday),
    end: dates[6],
    dates
  }
}

/** '2026-W36' -> 该周的 7 个日期（周一到周日） */
export function weekKeyToDates(weekKey: string): string[] {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey)
  if (!m) return []
  const year = Number(m[1])
  const week = Number(m[2])
  // 1 月 4 日必然落在 ISO 第 1 周
  const jan4 = new Date(year, 0, 4)
  const dow = (jan4.getDay() + 6) % 7 // 0 = 周一
  const week1Monday = new Date(year, 0, 4 - dow)
  const monday = new Date(
    week1Monday.getFullYear(),
    week1Monday.getMonth(),
    week1Monday.getDate() + (week - 1) * 7
  )
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
    dates.push(toDateStr(d))
  }
  return dates
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
