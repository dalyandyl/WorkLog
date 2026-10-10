import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface DropdownOption {
  value: string
  label: string
}

interface DropdownSelectProps {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  title?: string
  className?: string
}

/**
 * 自绘圆角下拉选择框（替代原生 select，解决原生下拉弹层方正、无法圆角的问题）。
 * 闭态为圆角按钮，开态为圆角面板菜单，风格与应用其它弹出层一致。
 */
export default function DropdownSelect({
  value,
  options,
  onChange,
  title,
  className
}: DropdownSelectProps) {
  const [open, setOpen] = useState(false)
  /** 键盘高亮项下标（-1 = 未用键盘导航） */
  const [active, setActive] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const listId = useRef(`wl-dd-${Math.random().toString(36).slice(2, 9)}`).current

  useEffect(() => {
    if (!open) return
    function onDocDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  // 打开时把键盘高亮定位到当前选项
  useEffect(() => {
    if (open) setActive(options.findIndex((o) => o.value === value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function close(restoreFocus = true): void {
    setOpen(false)
    if (restoreFocus) btnRef.current?.focus()
  }

  function commit(index: number): void {
    const opt = options[index]
    if (!opt) return
    onChange(opt.value)
    close()
  }

  /**
   * 键盘导航：↑↓ 移动、Home/End 跳首尾、Enter/Space 选中、Esc 关闭。
   * 改造前虽然补了 `role="listbox"` 等 ARIA 属性，但完全没有键盘支持 ——
   * 读屏用户能听见"列表"，却无法用键盘选任何一项。
   */
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation()
        close()
      }
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1
        return Math.max(0, Math.min(next, options.length - 1))
      })
      return
    }
    if (e.key === 'Home' && open) {
      e.preventDefault()
      setActive(0)
      return
    }
    if (e.key === 'End' && open) {
      e.preventDefault()
      setActive(options.length - 1)
      return
    }
    if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault()
      commit(active)
      return
    }
    if ((e.key === 'Enter' || e.key === ' ') && !open) {
      e.preventDefault()
      setOpen(true)
    }
  }

  const current = options.find((o) => o.value === value)

  return (
    <div className="dd" ref={ref} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={btnRef}
        className={'dd-btn' + (className ? ' ' + className : '')}
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-label={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
      >
        <span className="dd-value">{current?.label ?? value}</span>
        <ChevronDown size={14} className={'dd-chev' + (open ? ' open' : '')} />
      </button>
      {open && (
        <div className="dd-menu" role="listbox" id={listId} aria-label={title}>
          {options.map((o, i) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={
                'dd-item' + (o.value === value ? ' active' : '') + (i === active ? ' kb-active' : '')
              }
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                onChange(o.value)
                close()
              }}
            >
              <span>{o.label}</span>
              {o.value === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}