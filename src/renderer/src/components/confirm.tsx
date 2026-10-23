import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertTriangle, Trash2 } from 'lucide-react'

export interface ConfirmOptions {
  title?: string
  message: string
  okText?: string
  cancelText?: string
  /** true = 危险操作（红色主按钮 + 图标） */
  danger?: boolean
}

/**
 * 自绘确认框，替代 window.confirm（原生弹框在无边框窗口里又白又丑，且无法跟随主题）。
 * 用法：`if (!(await confirmDialog({ message: '…', danger: true }))) return`
 */
export function confirmDialog(options: string | ConfirmOptions): Promise<boolean> {
  const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options
  return new Promise<boolean>((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const finish = (value: boolean): void => {
      root.unmount()
      host.remove()
      resolve(value)
    }
    root.render(<ConfirmDialog {...opts} onFinish={finish} />)
  })
}

function ConfirmDialog(props: ConfirmOptions & { onFinish: (v: boolean) => void }): React.ReactElement {
  const { title, message, okText = '确定', cancelText = '取消', danger, onFinish } = props
  const [show, setShow] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setShow(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        onFinish(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onFinish(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onFinish])

  return (
    <div
      className={'wl-overlay confirm-overlay' + (show ? ' on' : '')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onFinish(false)
      }}
    >
      <div className="confirm-card" role="alertdialog" aria-modal="true">
        <div className="confirm-body">
          <span className={'confirm-icon' + (danger ? ' danger' : '')}>
            {danger ? <Trash2 size={18} /> : <AlertTriangle size={18} />}
          </span>
          <div className="confirm-text">
            <div className="confirm-title">{title ?? (danger ? '确认删除？' : '请确认')}</div>
            <div className="confirm-message">{message}</div>
          </div>
        </div>
        <div className="confirm-actions">
          <button className="btn" onClick={() => onFinish(false)}>
            {cancelText}
          </button>
          <button
            className={'btn ' + (danger ? 'btn--danger-solid' : 'btn--primary')}
            onClick={() => onFinish(true)}
            autoFocus
          >
            {okText}
          </button>
        </div>
      </div>
    </div>
  )
}
