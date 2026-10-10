import type { ReactNode } from 'react'
import Overlay from './Overlay'

interface DrawerProps {
  open: boolean
  title: string
  width?: number
  onClose: () => void
  children: ReactNode
}

/**
 * 右侧抽屉。行为（Escape / 遮罩点击 / 焦点陷阱 / ARIA / 滚动锁）统一在 `Overlay` 中实现，
 * 这里只固定 variant 与默认宽度。
 */
export default function Drawer({ open, title, width = 560, onClose, children }: DrawerProps) {
  return (
    <Overlay open={open} title={title} variant="drawer" width={width} onClose={onClose}>
      {children}
    </Overlay>
  )
}
