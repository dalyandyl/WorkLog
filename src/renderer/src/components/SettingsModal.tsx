import { confirmDialog } from './confirm'
import { useEffect, useState } from 'react'
import { BookOpenText, RefreshCw, Download, Upload, Cloud, CloudDownload, Settings2, FolderOpen, KeyRound } from 'lucide-react'
import type { AccentColor, AppSettings } from '../types'
import { matchAccessKey } from '../../../shared/access'
import DropdownSelect from './DropdownSelect'
import Modal from './Modal'

interface SettingsModalProps {
  open: boolean
  settings: AppSettings
  onChange: (s: AppSettings) => void
  onClose: () => void
  onStatus: (msg: string) => void
}

type Tab = 'theme' | 'access' | 'reminder' | 'backup' | 'sync' | 'about'

const TABS: { key: Tab; label: string }[] = [
  { key: 'theme', label: '外观主题' },
  { key: 'access', label: '权限认证' },
  { key: 'reminder', label: '每日提醒' },
  { key: 'backup', label: '数据备份' },
  { key: 'sync', label: '跨设备同步' },
  { key: 'about', label: '关于系统' }
]

const ACCENT_OPTIONS: { key: AccentColor; label: string; color: string }[] = [
  { key: 'blue', label: '蓝色', color: '#3b82f6' },
  { key: 'indigo', label: '靛蓝', color: '#6366f1' },
  { key: 'violet', label: '紫色', color: '#8b5cf6' },
  { key: 'green', label: '绿色', color: '#10b981' },
  { key: 'rose', label: '玫红', color: '#f43f5e' },
  { key: 'amber', label: '琥珀', color: '#f59e0b' }
]

export default function SettingsModal({ open, settings, onChange, onClose, onStatus }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>('theme')
  const [showWebdav, setShowWebdav] = useState(false)
  // 权限认证：密匙输入与错误提示（解锁状态本身存在 settings.momproAccess 里）
  const [keyInput, setKeyInput] = useState('')
  const [keyError, setKeyError] = useState(false)

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
    setKeyInput('')
    setKeyError(false)
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
        const srcLabel =
          p.source === 'gitee' ? 'Gitee 源' : p.source === 'github' ? 'GitHub 源' : ''
        setUpdText(`发现新版本 v${p.version}${srcLabel ? `（${srcLabel}）` : ''}，是否立即下载更新？`)
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

  function setGlass(g: AppSettings['glass']): void {
    onChange({ ...settings, glass: g })
  }
  function setAccent(a: AccentColor): void {
    onChange({ ...settings, accent: a })
  }

  /** 校验密匙：对上就写 settings.momproAccess，导航里的「功能台账」随之出现 */
  function unlockMomPro(): void {
    if (!matchAccessKey(keyInput)) {
      setKeyError(true)
      return
    }
    setKeyError(false)
    setKeyInput('')
    onChange({ ...settings, momproAccess: true })
    onStatus('功能台账已解锁')
  }

  function lockMomPro(): void {
    setKeyInput('')
    setKeyError(false)
    onChange({ ...settings, momproAccess: false })
    onStatus('功能台账已锁定')
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
      if (!await confirmDialog('本地有未同步到云端的改动，从云端下载可能被合并覆盖，是否继续？')) return
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
              <h4>系统主题</h4>
              <div className="settings-theme-options">
                {(
                  [
                    ['aurora', '极光玻璃'],
                    ['graphite', '石墨工位'],
                    ['amber', '黑曜琥珀'],
                    ['deep', '深海青'],
                    ['light', '浅色（原版）']
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
              <div className="settings-hint">
                四套暗色玻璃 + 一套浅色；玻璃为应用内实现，Win10 与 Win11 表现一致。
              </div>
              <h4>玻璃强度</h4>
              <div className="settings-theme-options">
                {(
                  [
                    ['off', '关闭'],
                    ['normal', '标准'],
                    ['strong', '强']
                  ] as const
                ).map(([v, label]) => (
                  <label key={v} className="settings-theme-item">
                    <input
                      type="radio"
                      name="glass"
                      checked={settings.glass === v}
                      onChange={() => setGlass(v)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div className="settings-hint">
                低配机器、或系统开启了「降低透明效果」时建议选「关闭」，可显著减少 GPU 占用。
              </div>
              <h4>强调色</h4>
              <div className="accent-swatches">
                {ACCENT_OPTIONS.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    className={'accent-swatch' + (settings.accent === a.key ? ' active' : '')}
                    style={{ background: a.color }}
                    title={a.label}
                    aria-label={a.label}
                    onClick={() => setAccent(a.key)}
                  />
                ))}
              </div>
              <div className="settings-hint">强调色会应用到导航选中态、按钮、链接等界面元素</div>
            </div>
          )}

          {tab === 'access' && (
            <div className="set-pane">
              <section className="set-group">
                <h4 className="set-group-title">个人专用模块</h4>
                <div className="set-row">
                  <div className="set-k">
                    <div className="set-k-title">功能台账</div>
                    <div className="set-k-desc">
                      {settings.momproAccess
                        ? '已解锁：顶部导航里会出现「功能台账」入口'
                        : '未解锁：顶部导航里不显示「功能台账」。输入密匙解锁后才能使用'}
                    </div>
                  </div>
                  <div className="set-ctl">
                    <span className={'pill' + (settings.momproAccess ? ' pill--ok' : '')}>
                      <i />
                      {settings.momproAccess ? '已解锁' : '未解锁'}
                    </span>
                  </div>
                </div>

                {settings.momproAccess ? (
                  <div className="set-row">
                    <div className="set-k">
                      <div className="set-k-title">重新锁定</div>
                      <div className="set-k-desc">锁定后入口从导航消失，已录入的台账数据仍保留在本地</div>
                    </div>
                    <div className="set-ctl">
                      <button className="btn btn--sm" type="button" onClick={lockMomPro}>
                        锁定
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="set-row">
                    <div className="set-k">
                      <div className="set-k-title">解锁密匙</div>
                      <div className={'set-k-desc' + (keyError ? ' set-hint--err' : '')}>
                        {keyError ? '密匙不正确，请重新输入。' : '密匙写死在程序里，不区分大小写'}
                      </div>
                    </div>
                    <div className="set-ctl">
                      <input
                        className="input set-key"
                        type="password"
                        value={keyInput}
                        placeholder="输入密匙"
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => {
                          setKeyInput(e.target.value)
                          if (keyError) setKeyError(false)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') unlockMomPro()
                        }}
                      />
                      <button
                        className="btn btn--primary btn--sm"
                        type="button"
                        disabled={!keyInput.trim()}
                        onClick={unlockMomPro}
                      >
                        <KeyRound size={13} />
                        解锁
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {tab === 'reminder' && (
            <div className="set-pane">
              <section className="set-group">
                <h4 className="set-group-title">提醒</h4>
                <div className="set-row">
                  <div className="set-k">
                    <div className="set-k-title">启用每日提醒</div>
                    <div className="set-k-desc">到点提醒你写当天日报；软件运行时生效（含最小化到托盘）</div>
                  </div>
                  <div className="set-ctl">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={settings.reminder.enabled}
                        onChange={(e) => setReminder({ enabled: e.target.checked })}
                      />
                      <span />
                    </label>
                  </div>
                </div>
                <div className="set-row">
                  <div className="set-k">
                    <div className="set-k-title">提醒时间</div>
                    <div className="set-k-desc">
                      {settings.reminder.enabled ? '每天这个时间弹一次提醒' : '启用提醒后才能设置'}
                    </div>
                  </div>
                  <div className="set-ctl">
                    <input
                      type="time"
                      className="input set-time"
                      value={settings.reminder.time}
                      disabled={!settings.reminder.enabled}
                      onChange={(e) => setReminder({ time: e.target.value })}
                    />
                  </div>
                </div>
              </section>
            </div>
          )}

          {tab === 'backup' && (
            <div className="set-pane">
              <section className="set-group">
                <h4 className="set-group-title">备份与恢复</h4>
                <div className="set-row">
                  <div className="set-k">
                    <div className="set-k-title">导出备份</div>
                    <div className="set-k-desc">把全部日志打包成 zip，可在其它设备导入恢复</div>
                  </div>
                  <div className="set-ctl">
                    <button className="btn btn--primary btn--sm" onClick={doBackup}>
                      <Download size={14} />
                      导出
                    </button>
                  </div>
                </div>
                <div className="set-row">
                  <div className="set-k">
                    <div className="set-k-title">导入备份</div>
                    <div className="set-k-desc">选择之前导出的 zip，合并回当前数据</div>
                  </div>
                  <div className="set-ctl">
                    <button className="btn btn--sm" onClick={doRestore}>
                      <Upload size={14} />
                      导入
                    </button>
                  </div>
                </div>
                <div className="set-row">
                  <div className="set-k">
                    <div className="set-k-title">存储位置</div>
                    <div className="set-k-desc">所有数据都是本地明文 JSON，可直接拷贝备份</div>
                    <div className="set-path" title={storageRoot}>
                      {storageRoot || '…'}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {tab === 'sync' && (
            <div className="set-pane">
              <section className="set-group">
                <h4 className="set-group-title">WebDAV 同步</h4>
                <div className="set-row">
                  <div className="set-k">
                    <div className="set-k-title">上传到云端</div>
                    <div className="set-k-desc">把本地数据打包上传，覆盖云端版本</div>
                  </div>
                  <div className="set-ctl">
                    <button className="btn btn--sm" onClick={doSyncPush}>
                      <Cloud size={14} />
                      上传
                    </button>
                  </div>
                </div>
                <div className="set-row">
                  <div className="set-k">
                    <div className="set-k-title">从云端下载</div>
                    <div className="set-k-desc">下载并合并到本地；检测到未同步改动时会先确认</div>
                  </div>
                  <div className="set-ctl">
                    <button className="btn btn--sm" onClick={doSyncPull}>
                      <CloudDownload size={14} />
                      下载
                    </button>
                  </div>
                </div>
                <div className="set-row">
                  <div className="set-k">
                    <div className="set-k-title">自动同步</div>
                    <div className="set-k-desc">
                      {settings.webdav.lastSyncAt
                        ? `最近同步：${new Date(settings.webdav.lastSyncAt).toLocaleString()}`
                        : '还没有同步过'}
                    </div>
                  </div>
                  <div className="set-ctl">
                    <DropdownSelect
                      value={settings.webdav.autoMode}
                      options={[
                        { value: 'off', label: '关闭' },
                        { value: 'startup', label: '启动时拉取' },
                        { value: 'exit', label: '退出时上传' },
                        { value: 'interval', label: '定时上传' }
                      ]}
                      onChange={(v) => setWebdav({ autoMode: v as AppSettings['webdav']['autoMode'] })}
                      title="自动同步时机"
                    />
                    {settings.webdav.autoMode === 'interval' && (
                      <>
                        <input
                          type="number"
                          className="input set-time"
                          min={5}
                          step={5}
                          value={settings.webdav.intervalMinutes}
                          onChange={(e) => setWebdav({ intervalMinutes: Number(e.target.value) || 30 })}
                          title="定时上传间隔（分钟）"
                        />
                        <span className="muted">分钟</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="set-row">
                  <div className="set-k">
                    <div className="set-k-title">服务器配置</div>
                    <div className="set-k-desc">坚果云、Nextcloud 等任意 WebDAV 服务</div>
                  </div>
                  <div className="set-ctl">
                    <button className="btn btn--sm" onClick={() => setShowWebdav((v) => !v)}>
                      <Settings2 size={14} />
                      {showWebdav ? '收起' : '配置'}
                    </button>
                  </div>
                </div>
              </section>

              {showWebdav && (
                <section className="set-group">
                  <h4 className="set-group-title">连接信息</h4>
                  <div className="webdav-config">
                    <input className="input webdav-input" placeholder="WebDAV 地址（如 https://dav.jianguoyun.com/dav/）" value={settings.webdav.url} onChange={(e) => setWebdav({ url: e.target.value })} />
                    <input className="input webdav-input" placeholder="账号（邮箱）" value={settings.webdav.username} onChange={(e) => setWebdav({ username: e.target.value })} />
                    <input className="input webdav-input" type="password" placeholder="密码（坚果云应用密码）" value={settings.webdav.password} onChange={(e) => setWebdav({ password: e.target.value })} />
                    <div className="set-k-desc">推荐坚果云：设置 → 安全选项 → 添加应用密码，作为 WebDAV 密码</div>
                  </div>
                </section>
              )}
            </div>
          )}

          {tab === 'about' && (
            <div className="set-pane">
              <section className="set-group">
                <h4 className="set-group-title">应用</h4>
                <div className="set-about">
                  <div className="about-logo">
                    <BookOpenText size={26} />
                  </div>
                  <div>
                    <div className="set-about-name">日志工具 WorkLog</div>
                    <div className="set-about-line">版本 v{info?.appVersion ?? '…'} · 作者 LHQ</div>
                  </div>
                </div>
              </section>

              <section className="set-group">
                <h4 className="set-group-title">运行环境</h4>
                <div className="set-kv"><span>Electron</span><b>{info?.electron ?? '…'}</b></div>
                <div className="set-kv"><span>Chromium</span><b>{info?.chrome ?? '…'}</b></div>
                <div className="set-kv"><span>Node.js</span><b>{info?.node ?? '…'}</b></div>
              </section>

              <section className="set-group">
                <h4 className="set-group-title">更新</h4>
                <div className="set-row">
                  <div className="set-k">
                    <div className="set-k-title">更新源</div>
                    <div className="set-k-desc">决定「检查更新」从哪个平台下载安装包</div>
                  </div>
                  <div className="set-ctl">
                    <DropdownSelect
                      value={settings.updateSource}
                      options={[
                        { value: 'auto', label: '自动（Gitee 优先）' },
                        { value: 'gitee', label: 'Gitee' },
                        { value: 'github', label: 'GitHub' }
                      ]}
                      onChange={(v) => {
                        const src = v as AppSettings['updateSource']
                        onChange({ ...settings, updateSource: src })
                        void window.api.setUpdateSource(src)
                      }}
                      title="选择「检查更新」从哪个平台下载安装包"
                    />
                  </div>
                </div>
                <div className="set-row">
                  <div className="set-k">
                    <div className="set-k-title">检查更新</div>
                    <div className="set-k-desc">
                      {updText || '当前已是最新版本时不会提示'}
                    </div>
                    {updStatus === 'progress' && updPercent !== undefined && (
                      <div className="about-progress">
                        <div className="about-progress-fill" style={{ width: `${updPercent}%` }} />
                      </div>
                    )}
                    {info && !info.packaged && (
                      <div className="set-k-desc" style={{ color: 'var(--t-rose)' }}>
                        当前为开发模式，检查更新仅在打包安装后可用
                      </div>
                    )}
                  </div>
                  <div className="set-ctl">
                    {(updStatus === '' || updStatus === 'checking' || updStatus === 'none' || updStatus === 'error') && (
                      <button className="btn btn--sm" onClick={check} disabled={checking}>
                        {checking ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />}
                        {checking ? '检查中…' : '检查更新'}
                      </button>
                    )}
                    {updStatus === 'available' && (
                      <>
                        <button className="btn btn--primary btn--sm" onClick={startDownload}>
                          立即更新
                        </button>
                        <button className="btn btn--sm" onClick={declineUpdate}>
                          暂不更新
                        </button>
                      </>
                    )}
                    {updStatus === 'downloaded' && (
                      <button className="btn btn--primary btn--sm" onClick={install}>
                        重启安装
                      </button>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
