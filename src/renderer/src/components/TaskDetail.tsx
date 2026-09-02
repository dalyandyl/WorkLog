import { useEffect, useRef, useState } from 'react'
import type { Tag, Task } from '../types'
import RichView from './RichView'

interface TaskDetailProps {
  task: Task
  date: string
  tags: Tag[]
}

/** 日报任务详情（只读）：标题 + 标签 + 子任务 + 正文 + 派发/完成时间 + 备注（唯一可编辑） */
export default function TaskDetail({ task, date, tags }: TaskDetailProps) {
  return (
    <div className="task-detail">
      <div className="task-detail-head">
        <h3 className={'task-title-view' + (task.done ? ' done' : '')}>
          {task.title || '（未命名）'}
        </h3>
      </div>
      <div className="tag-chips">
        {task.tags.map((id) => {
          const t = tags.find((x) => x.id === id)
          if (!t) return null
          return (
            <span key={id} className="task-item-tag" style={{ borderColor: t.color, color: t.color }}>
              {t.name}
            </span>
          )
        })}
        {task.tags.length === 0 && <span className="muted">（无标签）</span>}
      </div>

      <div className="task-time-info">
        <span>📅 派发：{new Date(task.publishedAt).toLocaleString()}</span>
        {task.completedAt && (
          <span>✅ 完成：{new Date(task.completedAt).toLocaleString()}</span>
        )}
      </div>

      {(task.subtasks ?? []).length > 0 && (
        <div className="subtask-list read">
          {(task.subtasks ?? []).map((st) => (
            <div key={st.id} className={'subtask-row' + (st.done ? ' done' : '')}>
              <span className="subtask-check">{st.done ? '☑' : '☐'}</span>
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
            </div>
          ))}
        </div>
      )}

      <div className="task-detail-body view">
        {task.body ? (
          <RichView content={task.body} />
        ) : (
          <div className="task-empty">暂无正文</div>
        )}
      </div>

      <NoteEditor task={task} date={date} />
    </div>
  )
}

/** 日报备注：唯一可编辑项，随任务在所有天共享，失焦/防抖自动保存 */
function NoteEditor({ task, date }: { task: Task; date: string }) {
  const [val, setVal] = useState(task.note ?? '')
  const timer = useRef<number | null>(null)

  useEffect(() => {
    setVal(task.note ?? '')
  }, [task.id, task.note])

  function onChange(v: string): void {
    setVal(v)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      void window.api.updateTask(date, task.id, { note: v })
    }, 600)
  }

  return (
    <div className="task-note">
      <div className="task-note-label">📝 备注</div>
      <textarea
        className="task-note-input"
        placeholder="给这个任务简单备注…（自动保存，随任务在所有天共享）"
        value={val}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
