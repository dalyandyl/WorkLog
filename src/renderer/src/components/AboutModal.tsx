import { useEffect, useState } from 'react'
import Modal from './Modal'

interface AboutModalProps {
  open: boolean
  onClose: () => void
}

interface AppInfo {
  appVersion: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  packaged: boolean
}

interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'progress' | 'none' | 'downloaded' | 'error'
  text: string
  percent?: number
}

export default function AboutModal({ open, onClose }: AboutModalProps) {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle', text: '' })
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!open) return
    setUpdateState({ status: 'idle', text: '' })
    setChecking(false)
    window.api.getAppInfo().then(setInfo)
    const off = window.api.onUpdateEvent(({ channel, payload }) => {
      const p = payload as Record<string, unknown>
      if (channel === 'checking') setUpdateState({ status: 'checking', text: '正在检查更新…' })
      else if (channel === 'available')
        setUpdateState({ status: 'available', text: `发现新版本 v${p.version}，正在下载…` })
      else if (channel === 'not-available') {
        setUpdateState({ status: 'none', text: '已是最新版本' })
        setChecking(false)
      } else if (channel === 'progress') {
        const percent = Number(p.percent ?? 0)
        setUpdateState({ status: 'progress', text: `正在下载更新 ${percent}%`, percent })
      } else if (channel === 'downloaded') {
        setUpdateState({ status: 'downloaded', text: `新版本 v${p.version} 已下载，重启后生效` })
        setChecking(false)
      } else if (channel === 'error') {
        setUpdateState({ status: 'error', text: `更新出错：${String(p.message ?? '')}` })
        setChecking(false)
      }
    })
    return off
  }, [open])

  async function check(): Promise<void> {
    setChecking(true)
    setUpdateState({ status: 'checking', text: '正在检查更新…' })
    const r = await window.api.checkUpdate()
    if (!r.ok) {
      setUpdateState({ status: 'error', text: r.message ?? '检查更新失败' })
      setChecking(false)
    }
  }

  function install(): void {
    void window.api.installUpdate()
  }

  return (
    <Modal open={open} title="关于系统" width={460} onClose={onClose}>
      <div className="about-body">
        <div className="about-app">
          <div className="about-logo">📓</div>
          <div>
            <div className="about-name">日志工具 WorkLog</div>
            <div className="about-version">版本 v{info?.appVersion ?? '…'}</div>
            <div className="about-author">作者：LHQ</div>
          </div>
        </div>

        <div className="about-info">
          <div className="about-row">
            <span>Electron</span>
            <span>{info?.electron ?? '…'}</span>
          </div>
          <div className="about-row">
            <span>Chromium</span>
            <span>{info?.chrome ?? '…'}</span>
          </div>
          <div className="about-row">
            <span>Node.js</span>
            <span>{info?.node ?? '…'}</span>
          </div>
          <div className="about-row">
            <span>系统</span>
            <span>
              {info ? `${info.platform} / ${info.arch}` : '…'}
            </span>
          </div>
        </div>

        <div className="about-update">
          <div className="about-update-actions">
            <button className="ghost-btn" onClick={check} disabled={checking}>
              {checking ? '检查中…' : '🔄 检查更新'}
            </button>
            {updateState.status === 'downloaded' && (
              <button className="ghost-btn" onClick={install}>
                立即重启安装
              </button>
            )}
          </div>
          {updateState.text && (
            <div className={'about-update-text ' + updateState.status}>{updateState.text}</div>
          )}
          {updateState.status === 'progress' && updateState.percent !== undefined && (
            <div className="about-progress">
              <div className="about-progress-fill" style={{ width: `${updateState.percent}%` }} />
            </div>
          )}
          {info && !info.packaged && (
            <div className="about-update-text error">当前为开发模式，检查更新仅在打包安装后可用</div>
          )}
        </div>
      </div>
    </Modal>
  )
}
