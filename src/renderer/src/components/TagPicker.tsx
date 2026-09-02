import { useEffect, useRef, useState } from 'react'
import type { Tag } from '../types'

interface TagPickerProps {
  selectedIds: string[]
  allTags: Tag[]
  onChange: (ids: string[]) => void
  onGoToTags?: () => void
}

export default function TagPicker({ selectedIds, allTags, onChange, onGoToTags }: TagPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const selected = allTags.filter((t) => selectedIds.includes(t.id))
  const available = allTags.filter((t) => !selectedIds.includes(t.id))

  function toggle(id: string): void {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  return (
    <div className="tag-picker" ref={rootRef}>
      <div className="tag-chips">
        {selected.map((t) => (
          <span
            key={t.id}
            className="tag-chip"
            style={{ borderColor: t.color, color: t.color }}
          >
            <span className="tag-dot" style={{ background: t.color }} />
            {t.name}
            <button
              className="tag-chip-x"
              onClick={() => toggle(t.id)}
              title="移除标签"
            >
              ×
            </button>
          </span>
        ))}
        <button className="tag-add-chip" onClick={() => setOpen((v) => !v)} title="添加标签">
          + 标签
        </button>
      </div>

      {open && (
        <div className="tag-menu">
          {available.length === 0 ? (
            <div className="tag-menu-empty">没有更多标签</div>
          ) : (
            available.map((t) => (
              <button key={t.id} className="tag-menu-item" onClick={() => toggle(t.id)}>
                <span className="tag-dot" style={{ background: t.color }} />
                {t.name}
              </button>
            ))
          )}
          {onGoToTags && (
            <button
              className="tag-menu-manage"
              onClick={() => {
                setOpen(false)
                onGoToTags()
              }}
            >
              管理标签…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
