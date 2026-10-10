import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * 弹窗 / 抽屉的共同基元。
 *
 * 改造前 `Modal.tsx` 与 `Drawer.tsx` 几乎逐行重复（只差 class 与默认宽度），
 * 且两者都**只做了 Escape 与遮罩点击**：没有 `role="dialog"` / `aria-modal`、
 * 没有焦点陷阱、没有初始聚焦、没有关闭后归还焦点、没有背景滚动锁。
 * 键盘与读屏用户基本无法可靠使用任何一个弹窗。
 *
 * 现在这些行为统一在这里实现（见 memory-bank/07-optimization-backlog.md P2-2）。
 */

export type OverlayVariant = 'modal' | 'drawer'

interface OverlayProps {
  open: boolean
  title: string
  variant: OverlayVariant
  /** 面板宽度（px） */
  width?: number
  /** 面板高度（px，仅 modal 使用） */
  height?: number
  onClose: () => void
  children: ReactNode
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

/**
 * 已打开的浮层栈。
 * 允许弹窗套弹窗（例如发布页里开抽屉再开延期弹窗）：
 * Escape 与 Tab 只应由**最上层**响应，否则一次按键会同时关掉多层。
 */
const overlayStack: symbol[] = []

export default function Overlay({
  open,
  title,
  variant,
  width,
  height,
  onClose,
  children
}: OverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const idRef = useRef(Symbol('wl-overlay'))
  const titleIdRef = useRef(`wl-overlay-title-${Math.random().toString(36).slice(2, 9)}`)
  /** 打开前的焦点元素，关闭时归还 */
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const self = idRef.current
    overlayStack.push(self)
    const isTop = (): boolean => overlayStack[overlayStack.length - 1] === self

    restoreRef.current = document.activeElement as HTMLElement | null

    function focusableNodes(): HTMLElement[] {
      const panel = panelRef.current
      if (!panel) return []
      return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      )
    }

    function onKey(e: KeyboardEvent): void {
      if (!isTop()) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      // 焦点陷阱：Tab / Shift+Tab 在面板内循环，不会跑到背景页面
      const panel = panelRef.current
      if (!panel) return
      const nodes = focusableNodes()
      if (nodes.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement as HTMLElement | null
      const outside = !active || !panel.contains(active)
      if (e.shiftKey) {
        if (outside || active === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (outside || active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKey, true)

    // 打开后把焦点移入浮层（优先第一个可聚焦元素，否则面板本身）
    const timer = window.setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      const nodes = focusableNodes()
      if (nodes.length > 0) nodes[0].focus()
      else panel.focus()
    }, 0)

    // 锁背景滚动
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.clearTimeout(timer)
      const idx = overlayStack.indexOf(self)
      if (idx !== -1) overlayStack.splice(idx, 1)
      document.body.style.overflow = prevOverflow
      // 归还焦点
      restoreRef.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const isDrawer = variant === 'drawer'
  const overlayClass = isDrawer ? 'wl-overlay drawer-overlay' : 'wl-overlay'
  const panelClass = isDrawer ? 'wl-drawer' : 'wl-modal'
  const headClass = isDrawer ? 'wl-drawer-head' : 'wl-modal-head'
  const bodyClass = isDrawer ? 'wl-drawer-body' : 'wl-modal-body'
  const style = isDrawer ? { width } : { width, height }

  return (
    <div
      className={overlayClass}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        className={panelClass}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleIdRef.current}
        tabIndex={-1}
      >
        <div className={headClass}>
          <h3 id={titleIdRef.current}>{title}</h3>
          <button className="wl-close" onClick={onClose} title="关闭" aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className={bodyClass}>{children}</div>
      </div>
    </div>
  )
}
