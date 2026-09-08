import { CalendarDays, CheckCircle2, CheckSquare, Pencil, Square, StickyNote, Trash2 } from 'lucide-react'
import type { Tag, Task } from '../types'
import RichView from './RichView'

interface TaskDetailProps {
  task: Task
  date: string
  tags: Tag[]
  onEdit?: () => void
  onDelete?: () => void
}

/** 日报任务详情（默认只读）：标题 + 标签 + 子任务 + 正文 + 派发/完成时间 + 备注 */
export default function TaskDetail({ task, date, tags, onEdit, onDelete }: TaskDetailProps) {
  return (
    <div className="task-detail">
      <div className="task-detail-head">
        <h3 className={'task-title-view' + (task.done ? ' done' : '')}>
          {task.title || '（未命名）'}
        </h3>
        {onEdit && (
          <button className="icon-btn" onClick={onEdit} title="编辑任务（所有天同步）">
            <Pencil size={15} />
          </button>
        )}
        {onDelete && (
          <button
            className="icon-btn danger"
            onClick={onDelete}
            title="删除任务（进回收站，所有天同步）"
          >
            <Trash2 size={15} />
          </button>
        )}
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
        <span>
          <CalendarDays size={13} />
          派发：{new Date(task.publishedAt).toLocaleString()}
        </span>
        {task.completedAt && (
          <span>
            <CheckCircle2 size={13} />
            完成：{new Date(task.completedAt).toLocaleString()}
          </span>
        )}
      </div>

      {(task.subtasks ?? []).length > 0 && (
        <div className="subtask-list read">
          {(task.subtasks ?? []).map((st) => (
            <div key={st.id} className={'subtask-row' + (st.done ? ' done' : '')}>
              <span className="subtask-check">
                {st.done ? <CheckSquare size={13} /> : <Square size={13} />}
              </span>
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

      {task.note && task.note.trim() && (
        <div className="task-note">
          <div className="task-note-label">
            <StickyNote size={13} />
            备注
          </div>
          <div className="task-note-view">{task.note}</div>
        </div>
      )}
    </div>
  )
}
