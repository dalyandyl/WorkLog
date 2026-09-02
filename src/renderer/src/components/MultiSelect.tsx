import { useEffect, useRef, useState } from 'react'

interface Option {
  id: string
  name: string
  color?: string
}

interface MultiSelectProps {
  options: Option[]
  value: string[]
  onChange: (ids: string[]) => void
  placeholder?: string
}

/** 通用多选下拉 */
export default function MultiSelect({ options, value, onChange, placeholder = '请选择' }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const selectedNames = options.filter((o) => value.includes(o.id)).map((o) => o.name)

  function toggle(id: string): void {
    if (value.includes(id)) onChange(value.filter((x) => x !== id))
    else onChange([...value, id])
  }

  return (
    <div className="multi-select" ref={ref}>
      <button className="multi-select-btn" onClick={() => setOpen((v) => !v)}>
        <span className="multi-select-text">
          {selectedNames.length === 0 ? placeholder : selectedNames.join('、')}
        </span>
        <span className="multi-select-arrow">▾</span>
      </button>
      {open && (
        <div className="multi-select-menu">
          {options.length === 0 ? (
            <div className="multi-select-empty">暂无项目，请先创建</div>
          ) : (
            options.map((o) => (
              <label key={o.id} className="multi-select-item">
                <input
                  type="checkbox"
                  checked={value.includes(o.id)}
                  onChange={() => toggle(o.id)}
                />
                {o.color && <span className="tag-dot" style={{ background: o.color }} />}
                {o.name}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  )
}
