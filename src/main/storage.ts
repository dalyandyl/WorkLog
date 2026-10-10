import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import type { WeekInfo } from '../shared/types'
import {
  enumerateDates,
  getWeekInfo,
  toDateStr,
  weekKeyToDates,
  weekdayName
} from '../shared/date'

export type { WeekInfo }
// 日期与 ISO 周工具的唯一实现在 src/shared/date.ts（主进程与渲染层共用），此处仅转发，
// 保持既有调用方 `from './storage'` 不变。
export { enumerateDates, getWeekInfo, toDateStr, weekKeyToDates, weekdayName }

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
