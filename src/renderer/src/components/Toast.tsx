import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import type { StatusLevel } from '../types'

export interface ToastItem {
  id: number
  msg: string
  level: StatusLevel
}

/** 停留时长（毫秒）：错误类需要更多时间阅读 */
const DURATION: Record<StatusLevel, number> = {
  info: 2600,
  success: 2600,
  error: 6500
}

/** 同屏最多保留的条数，超出丢弃最旧的 */
const MAX_TOASTS = 4

/**
 * 收集用户反馈的 hook，替代已失效的底部状态栏。
 * 返回 `[toasts, notify, dismiss]`，`notify` 可直接作为 `onStatus` 传给各视图。
 */
export function useToasts(): {
  toasts: ToastItem[]
  notify: (msg: string, level?: StatusLevel) => void
  dismiss: (id: number) => void
} {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const notify = useCallback(
    (msg: string, level: StatusLevel = 'info') => {
      const text = String(msg ?? '').trim()
      if (!text) return
      const id = ++seq.current
      setToasts((prev) => {
        // 连续相同的消息只保留一条（避免重复点击堆叠出一模一样的提示）
        const dup = prev.find((t) => t.msg === text && t.level === level)
        if (dup) return prev
        const next = [...prev, { id, msg: text, level }]
        return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next
      })
      const timer = window.setTimeout(() => dismiss(id), DURATION[level])
      timers.current.set(id, timer)
    },
    [dismiss]
  )

  // 卸载时清理所有定时器
  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) window.clearTimeout(t)
      map.clear()
    }
  }, [])

  return { toasts, notify, dismiss }
}

function iconOf(level: StatusLevel): ReactElement {
  if (level === 'error') return <AlertTriangle size={15} />
  if (level === 'success') return <CheckCircle2 size={15} />
  return <Info size={15} />
}

/** 右下角反馈气泡栈（与更新气泡共用右下角区域，位于其上方） */
export default function ToastStack({
  toasts,
  onDismiss
}: {
  toasts: ToastItem[]
  onDismiss: (id: number) => void
}): ReactElement | null {
  if (toasts.length === 0) return null
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.level}`}>
          <span className="toast-icon">{iconOf(t.level)}</span>
          <span className="toast-msg">{t.msg}</span>
          <button className="toast-close" onClick={() => onDismiss(t.id)} aria-label="关闭提示" title="关闭">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
