import { getWeekInfo, weekKeyToDates, type WeekInfo } from './storage'
import type { WeeklySummary } from '../shared/types'
import { readJson, writeJson, removeFile, withDataLock } from './jsonStore'
import { weeklyPath } from './paths'

export type { WeeklySummary }
export { weeklyPath }

export async function readWeeklySummary(
  root: string,
  weekKey: string
): Promise<WeeklySummary> {
  const file = weeklyPath(root, weekKey)
  // 用 null 区分「文件不存在/已损坏」与「存在但内容为空」
  const data = await readJson<{ weekKey?: string; summary?: unknown } | null>(file, null)
  if (data === null) return { weekKey, summary: '', exists: false }
  return { weekKey, summary: typeof data.summary === 'string' ? data.summary : '', exists: true }
}

export async function writeWeeklySummary(
  root: string,
  weekKey: string,
  summary: string
): Promise<{ ok: boolean }> {
  const file = weeklyPath(root, weekKey)
  try {
    await withDataLock(async () => {
      if (summary.trim() === '') {
        await removeFile(file)
        return
      }
      await writeJson(file, { weekKey, summary })
    })
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
