import { useEffect, useRef, useState } from 'react'
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
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = options.find((o) => o.value === value)

  return (
    <div className="dd" ref={ref}>
      <button
        type="button"
        className={'dd-btn' + (className ? ' ' + className : '')}
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="dd-value">{current?.label ?? value}</span>
        <ChevronDown size={14} className={'dd-chev' + (open ? ' open' : '')} />
      </button>
      {open && (
        <div className="dd-menu" role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={'dd-item' + (o.value === value ? ' active' : '')}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
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