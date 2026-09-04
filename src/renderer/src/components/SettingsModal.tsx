import { useEffect, useState } from 'react'
import type { AppSettings } from '../types'
import Modal from './Modal'

interface SettingsModalProps {
  open: boolean
  settings: AppSettings
  onChange: (s: AppSettings) => void
  onClose: () => void
  onStatus: (msg: string) => void
}

type Tab = 'theme' | 'reminder' | 'backup' | 'sync' | 'about'

const TABS: { key: Tab; label: string }[] = [
  { key: 'theme', label: '外观主题' },
  { key: 'reminder', label: '每日提醒' },
  { key: 'backup', label: '数据备份' },
  { key: 'sync', label: '跨设备同步' },
  { key: 'about', label: '关于系统' }
]

export default function SettingsModal({ open, settings, onChange, onClose, onStatus }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>('theme')
  const [showWebdav, setShowWebdav] = useState(false)

  // 关于系统的信息与更新状态
  const [info, setInfo] = useState<{
    appVersion: string
    electron: string
    chrome: string
    node: string
    platform: string
    arch: string
    packaged: boolean
  } | null>(null)
  const [updText, setUpdText] = useState('')
  const [updStatus, setUpdStatus] = useState('')
  const [updPercent, setUpdPercent] = useState<number | undefined>(undefined)
  const [checking, setChecking] = useState(false)
  const [storageRoot, setStorageRoot] = useState('')

  useEffect(() => {
    if (!open) return
    setTab('theme')
    setShowWebdav(false)
    setUpdText('')
    setUpdStatus('')
    setUpdPercent(undefined)
    setChecking(false)
    window.api.getAppInfo().then(setInfo)
    window.api.getStorageRoot().then(setStorageRoot)
    const off = window.api.onUpdateEvent(({ channel, payload }) => {
      const p = payload as Record<string, unknown>
      if (channel === 'checking') {
        setUpdText('正在检查更新…')
        setUpdStatus('checking')
      } else if (channel === 'available') {
        setUpdText(`发现新版本 v${p.version}，是否立即下载更新？`)
        setUpdStatus('available')
        setChecking(false)
      } else if (channel === 'not-available') {
        setUpdText('已是最新版本')
        setUpdStatus('none')
        setChecking(false)
      } else if (channel === 'progress') {
        setUpdText(`正在下载更新 ${p.percent}%`)
        setUpdPercent(Number(p.percent ?? 0))
        setUpdStatus('progress')
      } else if (channel === 'downloaded') {
        setUpdText(`新版本 v${p.version} 已下载，请重启安装`)
        setUpdStatus('downloaded')
        setChecking(false)
      } else if (channel === 'error') {
        setUpdText(`更新出错：${String(p.message ?? '')}`)
        setUpdStatus('error')
        setChecking(false)
      }
    })
    return off
  }, [open])

  function setReminder(patch: Partial<AppSettings['reminder']>): void {
    onChange({ ...settings, reminder: { ...settings.reminder, ...patch } })
  }
  function setWebdav(patch: Partial<AppSettings['webdav']>): void {
    onChange({ ...settings, webdav: { ...settings.webdav, ...patch } })
  }
  function setTheme(t: AppSettings['theme']): void {
    onChange({ ...settings, theme: t })
  }

  async function doBackup(): Promise<void> {
    const r = await window.api.backupExport()
    if (r.ok) onStatus('备份已导出：' + r.path)
    else if (!r.canceled) onStatus('备份失败：' + (r.error || '未知错误'))
  }
  async function doRestore(): Promise<void> {
    const r = await window.api.backupImport()
    if (r.ok) onStatus('备份已导入')
    else if (!r.canceled) onStatus('导入失败：' + (r.error || '未知错误'))
  }
  async function doSyncPush(): Promise<void> {
    const r = await window.api.syncPush()
    onStatus(r.ok ? '已上传到云端' : '上传失败：' + (r.error || '未知错误'))
  }
  async function doSyncPull(): Promise<void> {
    // 冲突提示：本地有比最近同步更新的改动时先确认
    const m = await window.api.syncLocalMtime()
    const last = settings.webdav.lastSyncAt
    if (m.ok && last && m.mtime > new Date(last).getTime()) {
      if (!window.confirm('本地有未同步到云端的改动，从云端下载可能被合并覆盖，是否继续？')) return
    }
    const r = await window.api.syncPull()
    onStatus(r.ok ? '已从云端下载合并' : '下载失败：' + (r.error || '未知错误'))
  }
  async function check(): Promise<void> {
    setChecking(true)
    setUpdText('正在检查更新…')
    setUpdStatus('checking')
    const r = await window.api.checkUpdate()
    if (!r.ok) {
      setUpdText(r.message ?? '检查更新失败')
      setUpdStatus('error')
      setChecking(false)
    }
  }
  async function startDownload(): Promise<void> {
    setUpdPercent(0)
    setUpdText('正在下载更新…')
    setUpdStatus('progress')
    const r = await window.api.downloadUpdate()
    if (!r.ok) {
      setUpdText(r.message ?? '下载更新失败')
      setUpdStatus('error')
    }
  }
  function declineUpdate(): void {
    setUpdText('')
    setUpdStatus('')
    setUpdPercent(undefined)
  }
  function install(): void {
    void window.api.installUpdate()
  }

  return (
    <Modal open={open} title="设置" width={760} onClose={onClose}>
      <div className="settings-modal">
        <div className="settings-modal-menu">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={'settings-menu-item' + (tab === t.key ? ' active' : '')}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="settings-modal-content">
          {tab === 'theme' && (
            <div className="settings-tab">
              <h4>外观主题</h4>
              <div className="settings-theme-options">
                {(
                  [
                    ['light', '浅色'],
                    ['dark', '深色'],
                    ['system', '跟随系统']
                  ] as const
                ).map(([v, label]) => (
                  <label key={v} className="settings-theme-item">
                    <input
                      type="radio"
                      name="theme"
                      checked={settings.theme === v}
                      onChange={() => setTheme(v)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {tab === 'reminder' && (
            <div className="settings-tab">
              <h4>每日提醒</h4>
              <label className="rest-toggle">
                <input
                  type="checkbox"
                  checked={settings.reminder.enabled}
                  onChange={(e) => setReminder({ enabled: e.target.checked })}
                />
                启用提醒
              </label>
              <input
                type="time"
                className="reminder-time"
                value={settings.reminder.time}
                disabled={!settings.reminder.enabled}
                onChange={(e) => setReminder({ time: e.target.value })}
              />
              <div className="settings-hint">软件运行时（含最小化到托盘）生效</div>
            </div>
          )}

          {tab === 'backup' && (
            <div className="settings-tab">
              <h4>数据备份</h4>
              <div className="settings-row">
                <button className="settings-btn" onClick={doBackup}>导出备份</button>
                <button className="settings-btn" onClick={doRestore}>导入备份</button>
              </div>
              <div className="settings-hint">导出为 zip 压缩包，可在其它设备导入恢复</div>
              <div className="settings-label">日志存放目录：</div>
              <div className="storage-path" title={storageRoot}>
                {storageRoot || '…'}
              </div>
            </div>
          )}

          {tab === 'sync' && (
            <div className="settings-tab">
              <h4>跨设备同步（WebDAV）</h4>
              <div className="settings-row">
                <button className="settings-btn" onClick={doSyncPush} title="把本地数据打包上传到云端">上传到云端</button>
                <button className="settings-btn" onClick={doSyncPull} title="从云端下载并合并到本地">从云端下载</button>
                <button className="settings-btn small" onClick={() => setShowWebdav((v) => !v)}>
                  {showWebdav ? '收起配置' : '配置'}
                </button>
              </div>
              <div className="settings-row">
                <label className="settings-label">自动同步：</label>
                <select
                  className="gran-select"
                  value={settings.webdav.autoMode}
                  onChange={(e) => setWebdav({ autoMode: e.target.value as AppSettings['webdav']['autoMode'] })}
                  title="自动同步时机"
                >
                  <option value="off">关闭</option>
                  <option value="startup">启动时拉取</option>
                  <option value="exit">退出时上传</option>
                  <option value="interval">定时上传</option>
                </select>
                {settings.webdav.autoMode === 'interval' && (
                  <>
                    <input
                      type="number"
                      className="sync-interval-input"
                      min={5}
                      step={5}
                      value={settings.webdav.intervalMinutes}
                      onChange={(e) => setWebdav({ intervalMinutes: Number(e.target.value) || 30 })}
                      title="定时上传间隔（分钟）"
                    />
                    <span className="settings-label">分钟</span>
                  </>
                )}
              </div>
              {settings.webdav.lastSyncAt && (
                <div className="settings-hint">最近同步：{new Date(settings.webdav.lastSyncAt).toLocaleString()}</div>
              )}
              {showWebdav && (
                <div className="webdav-config">
                  <input className="webdav-input" placeholder="WebDAV 地址（如 https://dav.jianguoyun.com/dav/）" value={settings.webdav.url} onChange={(e) => setWebdav({ url: e.target.value })} />
                  <input className="webdav-input" placeholder="账号（邮箱）" value={settings.webdav.username} onChange={(e) => setWebdav({ username: e.target.value })} />
                  <input className="webdav-input" type="password" placeholder="密码（坚果云应用密码）" value={settings.webdav.password} onChange={(e) => setWebdav({ password: e.target.value })} />
                  <div className="settings-hint">推荐坚果云：设置 → 安全选项 → 添加应用密码，作为 WebDAV 密码</div>
                </div>
              )}
              <div className="settings-hint">冲突提示：下载前若检测到本地有未同步改动会先确认；多端使用请以较新上传为准</div>
            </div>
          )}

          {tab === 'about' && (
            <div className="settings-tab">
              <h4>关于系统</h4>
              <div className="about-app">
                <div className="about-logo">📓</div>
                <div>
                  <div className="about-name">日志工具 WorkLog</div>
                  <div className="about-version">版本 v{info?.appVersion ?? '…'}</div>
                  <div className="about-author">作者：LHQ</div>
                </div>
              </div>
              <div className="about-info">
                <div className="about-row"><span>Electron</span><span>{info?.electron ?? '…'}</span></div>
                <div className="about-row"><span>Chromium</span><span>{info?.chrome ?? '…'}</span></div>
                <div className="about-row"><span>Node.js</span><span>{info?.node ?? '…'}</span></div>
              </div>
              <div className="about-update">
                <div className="about-update-actions">
                  {updStatus === '' ||
                  updStatus === 'checking' ||
                  updStatus === 'none' ||
                  updStatus === 'error' ? (
                    <button className="ghost-btn" onClick={check} disabled={checking}>
                      {checking ? '检查中…' : '🔄 检查更新'}
                    </button>
                  ) : null}
                  {updStatus === 'available' && (
                    <>
                      <button className="ghost-btn" onClick={startDownload}>
                        立即更新
                      </button>
                      <button className="ghost-btn" onClick={declineUpdate}>
                        暂不更新
                      </button>
                    </>
                  )}
                  {updStatus === 'downloaded' && (
                    <button className="ghost-btn" onClick={install}>立即重启安装</button>
                  )}
                </div>
                {updText && (
                  <div className={'about-update-text' + (updStatus === 'error' ? ' error' : '')}>
                    {updText}
                  </div>
                )}
                {updStatus === 'progress' && updPercent !== undefined && (
                  <div className="about-progress">
                    <div className="about-progress-fill" style={{ width: `${updPercent}%` }} />
                  </div>
                )}
                {info && !info.packaged && (
                  <div className="about-update-text error">当前为开发模式，检查更新仅在打包安装后可用</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
