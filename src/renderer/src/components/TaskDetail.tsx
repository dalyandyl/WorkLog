import { useMemo, useState } from 'react'
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  Pencil,
  Save,
  Square,
  StickyNote,
  Trash2,
  X
} from 'lucide-react'
import type { Tag, Task } from '../types'
import RichView from './RichView'
import TagBadgeList from './TagBadge'

interface TaskDetailProps {
  task: Task
  tags: Tag[]
  onEdit?: () => void
  onDelete?: () => void
  onPostpone?: () => void
  /** 底部备注独立编辑（保存后所有天同步） */
  onUpdateNote?: (note: string) => Promise<void>
}

/** 日报任务详情（默认只读）：标题 + 标签 + 子任务 + 正文 + 派发/完成时间 + 底部备注独立编辑 */
export default function TaskDetail({
  task,
  tags,
  onEdit,
  onDelete,
  onPostpone,
  onUpdateNote
}: TaskDetailProps) {
  const [noteEditing, setNoteEditing] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  // 标签 id → Tag 映射：避免每个徽章都做一次线性 find
  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags])

  function startNoteEdit(): void {
    setNoteDraft(task.note ?? '')
    setNoteEditing(true)
  }

  async function saveNote(): Promise<void> {
    if (!onUpdateNote) return
    await onUpdateNote(noteDraft.trim())
    setNoteEditing(false)
  }

  return (
    <div className="task-detail">
      <div className="task-detail-head">
        <h3 className={'task-title-view' + (task.done ? ' done' : '')}>
          {task.title || '（未命名）'}
        </h3>
        {onPostpone && !task.done && (
          <button className="icon-btn" onClick={onPostpone} title="延期（追加自定义区间，所有天同步）" aria-label="延期（追加自定义区间，所有天同步）">
            <CalendarClock size={15} />
          </button>
        )}
        {onEdit && (
          <button className="icon-btn" onClick={onEdit} title="编辑任务（所有天同步）" aria-label="编辑任务（所有天同步）">
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
        <TagBadgeList ids={task.tags} tagMap={tagMap} />
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
                <TagBadgeList ids={st.tags} tagMap={tagMap} />
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

      {/* 底部备注：独立编辑（不进入整任务编辑模式），保存后所有天同步 */}
      <div className="task-note">
        <div className="task-note-label">
          <StickyNote size={13} />
          备注
          {onUpdateNote && !noteEditing && (
            <button className="icon-btn note-edit-btn" onClick={startNoteEdit} title="编辑备注（所有天同步）" aria-label="编辑备注（所有天同步）">
              <Pencil size={12} />
            </button>
          )}
        </div>
        {noteEditing ? (
          <>
            <textarea
              className="task-note-input"
              placeholder="给这个任务简单备注…（保存后随任务在所有天共享）"
              value={noteDraft}
              autoFocus
              onChange={(e) => setNoteDraft(e.target.value)}
            />
            <div className="task-note-actions">
              <button className="icon-btn primary" onClick={saveNote} title="保存备注（所有天同步）" aria-label="保存备注（所有天同步）">
                <Save size={14} />
              </button>
              <button className="icon-btn" onClick={() => setNoteEditing(false)} title="取消" aria-label="取消">
                <X size={14} />
              </button>
            </div>
          </>
        ) : task.note && task.note.trim() ? (
          <div className="task-note-view">{task.note}</div>
        ) : (
          <div className="task-note-empty">（无备注）</div>
        )}
      </div>
    </div>
  )
}
