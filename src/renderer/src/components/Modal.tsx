import type { ReactNode } from 'react'
import Overlay from './Overlay'

interface ModalProps {
  open: boolean
  title: string
  width?: number
  height?: number
  onClose: () => void
  children: ReactNode
}

/**
 * 居中弹窗。行为（Escape / 遮罩点击 / 焦点陷阱 / ARIA / 滚动锁）统一在 `Overlay` 中实现，
 * 这里只固定 variant 与默认宽度。
 */
export default function Modal({
  open,
  title,
  width = 640,
  height,
  onClose,
  children
}: ModalProps) {
  return (
    <Overlay
      open={open}
      title={title}
      variant="modal"
      width={width}
      height={height}
      onClose={onClose}
    >
      {children}
    </Overlay>
  )
}
