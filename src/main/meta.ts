import { promises as fs } from 'fs'
import path from 'path'
import type { AppSettings } from '../shared/types'

export type { AppSettings }

interface RestFile {
  dates: Record<string, { rest: boolean }>
}

export function restPath(root: string): string {
  return path.join(root, 'rest.json')
}

export function settingsPath(root: string): string {
  return path.join(root, 'settings.json')
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  reminder: { enabled: false, time: '18:00' },
  webdav: { enabled: false, url: '', username: '', password: '' }
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8')
}

export async function readSettings(root: string): Promise<AppSettings> {
  const s = await readJson<Partial<AppSettings>>(settingsPath(root), {})
  return {
    theme: s.theme ?? DEFAULT_SETTINGS.theme,
    reminder: {
      enabled: s.reminder?.enabled ?? DEFAULT_SETTINGS.reminder.enabled,
      time: s.reminder?.time ?? DEFAULT_SETTINGS.reminder.time
    },
    webdav: {
      enabled: s.webdav?.enabled ?? DEFAULT_SETTINGS.webdav.enabled,
      url: s.webdav?.url ?? DEFAULT_SETTINGS.webdav.url,
      username: s.webdav?.username ?? DEFAULT_SETTINGS.webdav.username,
      password: s.webdav?.password ?? DEFAULT_SETTINGS.webdav.password
    }
  }
}

export async function writeSettings(root: string, s: AppSettings): Promise<void> {
  await writeJson(settingsPath(root), s)
}

/** 读取休息日标记表 */
export async function readRestMap(root: string): Promise<Set<string>> {
  const data = await readJson<RestFile>(restPath(root), { dates: {} })
  const set = new Set<string>()
  for (const [date, v] of Object.entries(data.dates ?? {})) {
    if (v?.rest === true) set.add(date)
  }
  return set
}

// 简单串行化 rest.json 的读写，避免并发竞态
let restLock: Promise<unknown> = Promise.resolve()

function withRestLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = restLock.then(fn, fn)
  restLock = run.catch(() => {})
  return run
}

export function isRest(root: string, date: string): Promise<boolean> {
  return withRestLock(async () => {
    const set = await readRestMap(root)
    return set.has(date)
  })
}

export async function setRest(root: string, date: string, rest: boolean): Promise<{ ok: boolean }> {
  return withRestLock(async () => {
    const data = await readJson<RestFile>(restPath(root), { dates: {} })
    if (rest) {
      data.dates[date] = { rest: true }
    } else {
      delete data.dates[date]
    }
    await writeJson(restPath(root), data)
    return { ok: true }
  })
}
