import { Download, RefreshCw, X } from 'lucide-react'

export type UpdateBubbleState =
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; version?: string; message: string }

interface UpdateBubbleProps {
  state: UpdateBubbleState | null
  onDownload: () => void
  onInstall: () => void
  onRetry: () => void
  onClose: () => void
}

/**
 * 右下角更新气泡：启动时检测到新版本后出现。
 * 不自动关闭，仅手动点 × 关闭；下载进度与安装按钮都在气泡内流转。
 */
export default function UpdateBubble({
  state,
  onDownload,
  onInstall,
  onRetry,
  onClose
}: UpdateBubbleProps) {
  if (!state) return null

  return (
    <div className="update-bubble" role="alert" aria-live="polite">
      <div className="update-bubble-head">
        <span className="update-bubble-title">
          <Download size={14} />
          软件更新
        </span>
        <button className="wl-close" onClick={onClose} title="关闭">
          <X size={15} />
        </button>
      </div>
      <div className="update-bubble-body">
        {state.kind === 'available' && (
          <>
            <div className="update-bubble-text">
              发现新版本 <b>v{state.version}</b>，是否立即更新？
            </div>
            <button className="update-bubble-btn" onClick={onDownload}>
              立即更新
            </button>
          </>
        )}

        {state.kind === 'downloading' && (
          <>
            <div className="update-bubble-text">正在下载更新 v{state.version}…</div>
            <div className="about-progress">
              <div className="about-progress-fill" style={{ width: `${state.percent}%` }} />
            </div>
            <div className="update-bubble-percent">{state.percent}%</div>
          </>
        )}

        {state.kind === 'downloaded' && (
          <>
            <div className="update-bubble-text">
              新版本 <b>v{state.version}</b> 已下载完成
            </div>
            <button className="update-bubble-btn" onClick={onInstall}>
              立即重启安装
            </button>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <div className="update-bubble-text error">更新出错：{state.message}</div>
            <button className="update-bubble-btn" onClick={onRetry}>
              <RefreshCw size={13} />
              重试
            </button>
          </>
        )}
      </div>
    </div>
  )
}
