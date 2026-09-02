import { useRef, useState } from 'react'
import type { Task, Tag } from '../types'

interface TaskListProps {
  tasks: Task[]
  tags: Tag[]
  selectedId: string | null
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onToggleSubtask: (taskId: string, subtaskId: string) => void
  onNew: () => void
  onReorder: (orderedIds: string[]) => void
}

const tagById = (tags: Tag[]) => new Map(tags.map((t) => [t.id, t]))

export default function TaskList({
  tasks,
  tags,
  selectedId,
  onSelect,
  onToggle,
  onToggleSubtask,
  onNew,
  onReorder
}: TaskListProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  const dragOverId = useRef<string | null>(null)
  const tagMap = tagById(tags)

  function handleDragStart(e: React.DragEvent, id: string): void {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e: React.DragEvent, id: string): void {
    e.preventDefault()
    dragOverId.current = id
  }

  function handleDrop(e: React.DragEvent, targetId: string): void {
    e.preventDefault()
    const from = dragId
    dragOverId.current = null
    setDragId(null)
    if (!from || from === targetId) return

    const fromTask = tasks.find((t) => t.id === from)
    const toTask = tasks.find((t) => t.id === targetId)
    if (!fromTask || !toTask) return
    // 只允许同组（完成状态相同）内重排
    if (fromTask.done !== toTask.done) return

    const next = [...tasks]
    const fromIdx = next.findIndex((t) => t.id === from)
    const toIdx = next.findIndex((t) => t.id === targetId)
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    onReorder(next.map((t) => t.id))
  }

  if (tasks.length === 0) {
    return (
      <div className="task-list">
        <div className="task-list-head">
          <button className="new-task-btn" onClick={onNew}>
            + 新建任务
          </button>
        </div>
        <div className="task-empty">暂无任务，点击「新建任务」开始记录</div>
      </div>
    )
  }

  return (
    <div className="task-list">
      <div className="task-list-head">
        <button className="new-task-btn" onClick={onNew}>
          + 新建任务
        </button>
      </div>
      {tasks.map((t) => {
        const cls = ['task-item', t.id === selectedId ? 'selected' : '', t.done ? 'done' : '']
          .filter(Boolean)
          .join(' ')
        return (
          <div
            key={t.id}
            className={cls}
            draggable
            onDragStart={(e) => handleDragStart(e, t.id)}
            onDragOver={(e) => handleDragOver(e, t.id)}
            onDrop={(e) => handleDrop(e, t.id)}
            onDragEnd={() => {
              setDragId(null)
              dragOverId.current = null
            }}
            onClick={() => onSelect(t.id)}
          >
            <div className="task-item-main">
              <span className="drag-handle" title="拖动排序">
                ⠿
              </span>
              <input
                type="checkbox"
                className="task-check"
                checked={t.done}
                onChange={() => onToggle(t.id)}
                onClick={(e) => e.stopPropagation()}
              />
              <span className={'task-title' + (t.title ? '' : ' empty')}>
                {t.title || '（未命名）'}
              </span>
              <span className="task-item-tags">
                {t.tags.map((id) => {
                  const tag = tagMap.get(id)
                  if (!tag) return null
                  return (
                    <span key={id} className="task-item-tag" style={{ borderColor: tag.color, color: tag.color }}>
                      {tag.name}
                    </span>
                  )
                })}
              </span>
            </div>
            {t.subtasks.length > 0 && (
              <div className="task-subtasks" onClick={(e) => e.stopPropagation()}>
                {t.subtasks.map((st) => (
                  <div key={st.id} className={'task-subtask' + (st.done ? ' done' : '')}>
                    <input
                      type="checkbox"
                      className="task-check"
                      checked={st.done}
                      onChange={() => onToggleSubtask(t.id, st.id)}
                    />
                    <span className="task-subtask-title">{st.title || '（未命名）'}</span>
                    <span className="task-subtask-tags">
                      {st.tags.map((id) => {
                        const tag = tagMap.get(id)
                        if (!tag) return null
                        return (
                          <span
                            key={id}
                            className="task-item-tag"
                            style={{ borderColor: tag.color, color: tag.color }}
                          >
                            {tag.name}
                          </span>
                        )
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
