import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type { WeekInfo } from '../shared/types'

export type { WeekInfo }

/**
 * 日志存储根目录。
 * 打包后：%APPDATA%/WorkLog/logs（持久目录，更新/重装不会被 NSIS 清除）
 * 开发中：<项目目录>/logs
 *
 * 注意：数据不能放在安装目录里，否则 NSIS 更新时旧版卸载器会 `RMDir /r $INSTDIR`
 * 把整个安装目录（含 logs）删掉，导致更新后数据被清空。
 * 更新前由 NSIS 的 customInit（build/nsis-preserve-logs.nsh）把
 * <安装目录>/logs 备份到 %APPDATA%/WorkLog/pre-update-backup/logs，
 * 新版启动时再经 migrateStorageRoot() 迁移回新目录。
 */
export function getStorageRoot(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('appData'), 'WorkLog', 'logs')
  }
  return path.join(app.getAppPath(), 'logs')
}

async function dirHasContent(p: string): Promise<boolean> {
  try {
    return (await fs.readdir(p)).length > 0
  } catch {
    return false
  }
}

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const ent of entries) {
    const s = path.join(src, ent.name)
    const d = path.join(dest, ent.name)
    if (ent.isDirectory()) await copyDirRecursive(s, d)
    else await fs.copyFile(s, d)
  }
}

/**
 * 打包版启动时一次性迁移数据目录（仅在目标为空时执行）：
 *   1) %APPDATA%/WorkLog/pre-update-backup/logs —— NSIS 更新前由旧安装目录备份
 *   2) <exe目录>/logs —— 旧安装目录（若更新卸载器未删净 / 直接解包运行）
 * 迁移成功后会删除来源，避免重复占用。
 */
export async function migrateStorageRoot(): Promise<void> {
  if (!app.isPackaged) return
  const target = getStorageRoot()
  if (await dirHasContent(target)) return

  const base = path.join(app.getPath('appData'), 'WorkLog')
  const backup = path.join(base, 'pre-update-backup', 'logs')
  const legacy = path.join(path.dirname(process.execPath), 'logs')

  const sources: { p: string; cleanup: string | null }[] = []
  if (await dirHasContent(backup)) {
    sources.push({ p: backup, cleanup: path.join(base, 'pre-update-backup') })
  }
  if (await dirHasContent(legacy)) {
    sources.push({ p: legacy, cleanup: legacy })
  }

  for (const s of sources) {
    try {
      await copyDirRecursive(s.p, target)
      if (s.cleanup) await fs.rm(s.cleanup, { recursive: true, force: true })
      return
    } catch (err) {
      console.error('migrateStorageRoot 迁移失败:', s.p, err)
    }
  }
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
