import { useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import type { Subtask, Tag } from '../types'

/** 子任务编辑器（发布表单 / 日报编辑 复用） */
export default function SubtaskEditor({
  subtasks,
  tags,
  onChange
}: {
  subtasks: Subtask[]
  tags: Tag[]
  onChange: (subs: Subtask[]) => void
}) {
  const [subInput, setSubInput] = useState('')
  const [openSubtag, setOpenSubtag] = useState<string | null>(null)

  function addSub(): void {
    const v = subInput.trim()
    if (!v) return
    onChange([...subtasks, { id: crypto.randomUUID(), title: v, done: false, tags: [] }])
    setSubInput('')
  }

  return (
    <div className="subtask-editor">
      <div className="subtask-add-row">
        <input
          className="subtask-add-input"
          placeholder="添加子任务（回车添加）"
          value={subInput}
          onChange={(e) => setSubInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addSub()
          }}
        />
        <button className="icon-btn primary" title="添加子任务" onClick={addSub}>
          <Plus size={15} />
        </button>
      </div>
      {subtasks.length > 0 && (
        <div className="subtask-list">
          {subtasks.map((st) => (
            <div key={st.id} className={'subtask-row' + (st.done ? ' done' : '')}>
              <input
                type="checkbox"
                className="task-check"
                checked={st.done}
                onChange={() =>
                  onChange(subtasks.map((s) => (s.id === st.id ? { ...s, done: !s.done } : s)))
                }
              />
              <span className="subtask-title">{st.title}</span>
              <span className="subtask-tags">
                {st.tags.map((id) => {
                  const t = tags.find((x) => x.id === id)
                  if (!t) return null
                  return (
                    <span
                      key={id}
                      className="task-item-tag"
                      style={{ borderColor: t.color, color: t.color }}
                    >
                      {t.name}
                    </span>
                  )
                })}
              </span>
              <button
                className="tag-add-chip"
                onClick={() => setOpenSubtag(openSubtag === st.id ? null : st.id)}
                title="添加标签"
              >
                + 标签
              </button>
              <button
                className="icon-btn danger"
                title="删除子任务"
                onClick={() => onChange(subtasks.filter((s) => s.id !== st.id))}
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      {openSubtag && (
        <div className="subtask-tag-menu">
          {tags.map((t) => {
            const st = subtasks.find((s) => s.id === openSubtag)
            const active = st?.tags.includes(t.id)
            return (
              <button
                key={t.id}
                className={'subtask-tag-item' + (active ? ' active' : '')}
                onClick={() => {
                  onChange(
                    subtasks.map((s) => {
                      if (s.id !== openSubtag) return s
                      const has = s.tags.includes(t.id)
                      return {
                        ...s,
                        tags: has ? s.tags.filter((x) => x !== t.id) : [...s.tags, t.id]
                      }
                    })
                  )
                }}
              >
                <span className="tag-dot" style={{ background: t.color }} />
                {t.name}
                {active && <Check size={13} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
