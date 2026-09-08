import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays } from 'lucide-react'

interface DatePickerProps {
  value: string // yyyy-mm-dd，空串表示未选
  onChange: (date: string) => void
  title?: string
  /** 按钮上显示的文字（默认显示日期本身） */
  label?: string
  /** 可选日期下限（含），仅作用于日视图 */
  minDate?: string
  /** 可选日期上限（含），仅作用于日视图 */
  maxDate?: string
  /** 弹出层通过 portal 渲染到 body（用于会被父容器裁剪的场景，如侧边栏日历标题） */
  portal?: boolean
}

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toDateStr(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`
}

function todayStr(): string {
  const now = new Date()
  return toDateStr(now.getFullYear(), now.getMonth(), now.getDate())
}

type DpView = 'days' | 'months' | 'years'

export default function DatePicker({
  value,
  onChange,
  title,
  label,
  minDate,
  maxDate,
  portal
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<DpView>('days')
  const ref = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const base = value || todayStr()
  const [viewYear, setViewYear] = useState(Number(base.slice(0, 4)))
  const [viewMonth, setViewMonth] = useState(Number(base.slice(5, 7)) - 1)

  // 每次打开时回到当前选中日期所在月份
  useEffect(() => {
    if (!open) return
    const b = value || todayStr()
    setViewYear(Number(b.slice(0, 4)))
    setViewMonth(Number(b.slice(5, 7)) - 1)
    setView('days')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // portal 模式：打开时记录触发按钮位置，弹出层用 fixed 定位渲染到 body，避免被父容器裁剪
  useEffect(() => {
    if (!open || !portal) return
    if (ref.current) {
      const r = ref.current.getBoundingClientRect()
      setPos({
        top: r.bottom + 8,
        left: Math.max(8, Math.min(r.left, window.innerWidth - 296))
      })
    }
  }, [open, portal, value])

  // 点击组件外部 / Esc 关闭
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent): void {
      const t = e.target as Node
      const inside =
        (ref.current && ref.current.contains(t)) || (popRef.current && popRef.current.contains(t))
      if (!inside) setOpen(false)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  function shiftBy(delta: number): void {
    if (view === 'days') {
      let y = viewYear
      let m = viewMonth + delta
      if (m < 0) {
        m = 11
        y--
      } else if (m > 11) {
        m = 0
        y++
      }
      setViewYear(y)
      setViewMonth(m)
    } else {
      setViewYear((y) => y + delta * (view === 'years' ? 12 : 1))
    }
  }

  const lead = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7 // 周一为第一列
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1)
  ]

  const today = todayStr()
  const selYear = value ? Number(value.slice(0, 4)) : -1
  const selMonth = value ? Number(value.slice(5, 7)) - 1 : -1
  const yearStart = Math.floor(viewYear / 12) * 12

  function pick(d: number): void {
    onChange(toDateStr(viewYear, viewMonth, d))
    setOpen(false)
  }

  function titleClick(): void {
    if (view === 'days') setView('months')
    else if (view === 'months') setView('years')
  }

  const popup = (
    <div
      className="dp-pop"
      ref={popRef}
      style={portal && pos ? { position: 'fixed', top: pos.top, left: pos.left, zIndex: 3000 } : undefined}
    >
      <div className="dp-head">
        <button
          className="dp-nav"
          onClick={() => shiftBy(-1)}
          title={view === 'days' ? '上个月' : view === 'months' ? '上一年' : '前一个年份段'}
        >
          ‹
        </button>
        <button className="dp-title" onClick={titleClick} title="点击切换 年 / 月 选择">
          {view === 'days' && `${viewYear} 年 ${viewMonth + 1} 月`}
          {view === 'months' && `${viewYear} 年`}
          {view === 'years' && `${yearStart} - ${yearStart + 11}`}
          {view !== 'years' && <span className="dp-title-arrow">▾</span>}
        </button>
        <button
          className="dp-nav"
          onClick={() => shiftBy(1)}
          title={view === 'days' ? '下个月' : view === 'months' ? '下一年' : '后一个年份段'}
        >
          ›
        </button>
      </div>

      {view === 'days' && (
        <>
          <div className="dp-week">
            {WEEK_LABELS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="dp-grid">
            {cells.map((d, i) => {
              if (d === null) return <span key={`blank${i}`} className="dp-day blank" />
              const ds = toDateStr(viewYear, viewMonth, d)
              const outOfRange =
                (minDate !== undefined && ds < minDate) ||
                (maxDate !== undefined && ds > maxDate)
              const cls =
                'dp-day' +
                (outOfRange ? ' disabled' : '') +
                (ds === value ? ' selected' : '') +
                (ds === today ? ' today' : '')
              return (
                <button key={d} className={cls} onClick={() => pick(d)} disabled={outOfRange}>
                  {d}
                </button>
              )
            })}
          </div>
        </>
      )}

      {view === 'months' && (
        <div className="dp-grid dp-grid-month">
          {Array.from({ length: 12 }, (_, m) => {
            const cls =
              'dp-cell' +
              (viewYear === selYear && m === selMonth ? ' selected' : '') +
              (viewYear === Number(today.slice(0, 4)) && m === Number(today.slice(5, 7)) - 1
                ? ' today'
                : '')
            return (
              <button
                key={m}
                className={cls}
                onClick={() => {
                  setViewMonth(m)
                  setView('days')
                }}
              >
                {m + 1} 月
              </button>
            )
          })}
        </div>
      )}

      {view === 'years' && (
        <div className="dp-grid dp-grid-month">
          {Array.from({ length: 12 }, (_, i) => {
            const y = yearStart + i
            const cls =
              'dp-cell' + (y === viewYear ? ' selected' : '') + (y === Number(today.slice(0, 4)) ? ' today' : '')
            return (
              <button
                key={y}
                className={cls}
                onClick={() => {
                  setViewYear(y)
                  setView('months')
                }}
              >
                {y}
              </button>
            )
          })}
        </div>
      )}

      <div className="dp-foot">
        <button
          className="dp-today-btn"
          onClick={() => {
            onChange(today)
            setOpen(false)
          }}
        >
          回到今天
        </button>
        {view !== 'days' && (
          <button className="dp-today-btn dp-back-btn" onClick={() => setView('days')}>
            返回日期
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="dp" ref={ref}>
      <button className="dp-btn" onClick={() => setOpen((o) => !o)} title={title ?? '选择日期'}>
        <CalendarDays size={13} className="dp-icon" />
        <span className="dp-text">{label || value || '选择日期'}</span>
      </button>
      {open && (portal ? createPortal(popup, document.body) : popup)}
    </div>
  )
}
