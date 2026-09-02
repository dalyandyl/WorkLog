import { promises as fs } from 'fs'
import path from 'path'
import { getWeekInfo, weekKeyToDates, type WeekInfo } from './storage'
import type { WeeklySummary } from '../shared/types'

export type { WeeklySummary }

export function weeklyPath(root: string, weekKey: string): string {
  return path.join(root, 'weekly', `${weekKey}.json`)
}

export async function readWeeklySummary(
  root: string,
  weekKey: string
): Promise<WeeklySummary> {
  try {
    const raw = await fs.readFile(weeklyPath(root, weekKey), 'utf-8')
    const data = JSON.parse(raw)
    return { weekKey, summary: typeof data.summary === 'string' ? data.summary : '', exists: true }
  } catch {
    return { weekKey, summary: '', exists: false }
  }
}

export async function writeWeeklySummary(
  root: string,
  weekKey: string,
  summary: string
): Promise<{ ok: boolean }> {
  const file = weeklyPath(root, weekKey)
  try {
    if (summary.trim() === '') {
      await fs.rm(file, { force: true })
      return { ok: true }
    }
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({ weekKey, summary }, null, 2), 'utf-8')
    return { ok: true }
  } catch (err) {
    console.error('writeWeeklySummary failed:', err)
    return { ok: false }
  }
}

/** 由 weekKey 得到该周信息（含 7 个日期） */
export function getWeekInfoByKey(weekKey: string): WeekInfo | null {
  const dates = weekKeyToDates(weekKey)
  if (dates.length === 0) return null
  return getWeekInfo(dates[0])
}

/** 上一周 / 下一周的 weekKey */
export function shiftWeekKey(weekKey: string, delta: number): string | null {
  const info = getWeekInfoByKey(weekKey)
  if (!info) return null
  const monday = new Date(info.start + 'T00:00:00')
  monday.setDate(monday.getDate() + delta * 7)
  const y = monday.getFullYear()
  const m = String(monday.getMonth() + 1).padStart(2, '0')
  const d = String(monday.getDate()).padStart(2, '0')
  return getWeekInfo(`${y}-${m}-${d}`).weekKey
}
