import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface DrawerProps {
  open: boolean
  title: string
  width?: number
  onClose: () => void
  children: ReactNode
}

export default function Drawer({ open, title, width = 560, onClose, children }: DrawerProps) {
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
    <div className="wl-overlay drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wl-drawer" style={{ width }}>
        <div className="wl-drawer-head">
          <h3>{title}</h3>
          <button className="wl-close" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="wl-drawer-body">{children}</div>
      </div>
    </div>
  )
}
