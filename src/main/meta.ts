import type { AppSettings } from '../shared/types'
import { readJson, writeJson } from './jsonStore'
import { settingsPath } from './paths'

export type { AppSettings }
export { settingsPath }

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  accent: 'blue',
  reminder: { enabled: false, time: '18:00' },
  webdav: {
    enabled: false,
    url: '',
    username: '',
    password: '',
    autoMode: 'off',
    intervalMinutes: 30,
    lastSyncAt: null
  },
  updateSource: 'auto'
}

export async function readSettings(root: string): Promise<AppSettings> {
  const s = await readJson<Partial<AppSettings>>(settingsPath(root), {})
  return {
    theme: s.theme ?? DEFAULT_SETTINGS.theme,
    accent: s.accent ?? DEFAULT_SETTINGS.accent,
    reminder: {
      enabled: s.reminder?.enabled ?? DEFAULT_SETTINGS.reminder.enabled,
      // 兜底非字符串（旧数据/手改文件可能写入数字），否则 tray 的 HH:MM 比较会永远不匹配
      time: typeof s.reminder?.time === 'string' ? s.reminder.time : DEFAULT_SETTINGS.reminder.time
    },
    webdav: {
      enabled: s.webdav?.enabled ?? DEFAULT_SETTINGS.webdav.enabled,
      url: s.webdav?.url ?? DEFAULT_SETTINGS.webdav.url,
      username: s.webdav?.username ?? DEFAULT_SETTINGS.webdav.username,
      password: s.webdav?.password ?? DEFAULT_SETTINGS.webdav.password,
      autoMode: s.webdav?.autoMode ?? DEFAULT_SETTINGS.webdav.autoMode,
      intervalMinutes: s.webdav?.intervalMinutes ?? DEFAULT_SETTINGS.webdav.intervalMinutes,
      lastSyncAt: s.webdav?.lastSyncAt ?? DEFAULT_SETTINGS.webdav.lastSyncAt
    },
    updateSource: s.updateSource ?? DEFAULT_SETTINGS.updateSource
  }
}

export async function writeSettings(root: string, s: AppSettings): Promise<void> {
  await writeJson(settingsPath(root), s)
}
