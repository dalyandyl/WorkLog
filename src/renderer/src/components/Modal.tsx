import { useEffect, type ReactNode } from 'react'
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

  return (
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
    </div>
  )
}
