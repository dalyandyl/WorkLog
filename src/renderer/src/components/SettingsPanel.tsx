import { useState } from 'react'
import type { AppSettings } from '../types'

interface SettingsPanelProps {
  settings: AppSettings
  onChange: (s: AppSettings) => void
  onStatus: (msg: string) => void
}

export default function SettingsPanel({ settings, onChange, onStatus }: SettingsPanelProps) {
  const [showWebdav, setShowWebdav] = useState(false)

  async function doBackup(): Promise<void> {
    const r = await window.api.backupExport()
    if (r.ok) onStatus('备份已导出：' + r.path)
    else if (r.canceled) onStatus('已取消备份')
    else onStatus('备份失败：' + (r.error || '未知错误'))
  }

  async function doRestore(): Promise<void> {
    const r = await window.api.backupImport()
    if (r.ok) onStatus('备份已导入')
    else if (r.canceled) onStatus('已取消导入')
    else onStatus('导入失败：' + (r.error || '未知错误'))
  }

  async function doSyncPush(): Promise<void> {
    const r = await window.api.syncPush()
    if (r.ok) onStatus('已上传到云端')
    else onStatus('上传失败：' + (r.error || '未知错误'))
  }

  async function doSyncPull(): Promise<void> {
    const r = await window.api.syncPull()
    if (r.ok) onStatus('已从云端下载合并')
    else onStatus('下载失败：' + (r.error || '未知错误'))
  }

  function setReminder(patch: Partial<AppSettings['reminder']>): void {
    onChange({ ...settings, reminder: { ...settings.reminder, ...patch } })
  }

  function setWebdav(patch: Partial<AppSettings['webdav']>): void {
    onChange({ ...settings, webdav: { ...settings.webdav, ...patch } })
  }

  return (
    <div className="settings-panel">
      <div className="settings-title">数据备份</div>
      <div className="settings-row">
        <button className="settings-btn" onClick={doBackup}>
          导出备份
        </button>
        <button className="settings-btn" onClick={doRestore}>
          导入备份
        </button>
      </div>

      <div className="settings-title">
        跨设备同步
        <button className="settings-btn small" onClick={() => setShowWebdav((v) => !v)}>
          {showWebdav ? '收起' : '配置'}
        </button>
      </div>
      <div className="settings-row">
        <button className="settings-btn" onClick={doSyncPush} title="把本地数据打包上传到云端">
          上传到云端
        </button>
        <button className="settings-btn" onClick={doSyncPull} title="从云端下载并合并到本地">
          从云端下载
        </button>
      </div>
      {showWebdav && (
        <div className="webdav-config">
          <input
            className="webdav-input"
            placeholder="WebDAV 地址（如 https://dav.jianguoyun.com/dav/）"
            value={settings.webdav.url}
            onChange={(e) => setWebdav({ url: e.target.value })}
          />
          <input
            className="webdav-input"
            placeholder="账号（邮箱）"
            value={settings.webdav.username}
            onChange={(e) => setWebdav({ username: e.target.value })}
          />
          <input
            className="webdav-input"
            type="password"
            placeholder="密码（坚果云应用密码）"
            value={settings.webdav.password}
            onChange={(e) => setWebdav({ password: e.target.value })}
          />
          <div className="settings-hint">推荐坚果云：设置 → 安全选项 → 添加应用密码，作为 WebDAV 密码</div>
        </div>
      )}

      <div className="settings-title">每日提醒</div>
      <div className="settings-row reminder-row">
        <label className="rest-toggle">
          <input
            type="checkbox"
            checked={settings.reminder.enabled}
            onChange={(e) => setReminder({ enabled: e.target.checked })}
          />
          启用
        </label>
        <input
          type="time"
          className="reminder-time"
          value={settings.reminder.time}
          disabled={!settings.reminder.enabled}
          onChange={(e) => setReminder({ time: e.target.value })}
        />
      </div>
      <div className="settings-hint">软件运行时（含最小化到托盘）生效</div>
    </div>
  )
}
