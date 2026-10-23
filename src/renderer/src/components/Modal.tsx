import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  title: string
  width?: number
  height?: number
  onClose: () => void
  children: ReactNode
}

export default function Modal({ open, title, width = 640, height, onClose, children }: ModalProps) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  // portal 到 body：模态框在 .shell（z-index:2 的层叠上下文）里时，永远压不过同级的
  // .topnav / .titlebar —— 实测会议纪要、任务发布的弹窗都会被顶部导航盖住。
  return createPortal(
    <div className="wl-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wl-modal" style={{ width, height }}>
        <div className="wl-modal-head">
          <h3>{title}</h3>
          <button className="wl-close" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="wl-modal-body">{children}</div>
      </div>
    </div>,
    document.body
  )
}
