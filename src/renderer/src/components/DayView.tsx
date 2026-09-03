import { useEffect, useState } from 'react'
import type { Subtask, Tag, Task } from '../types'
import { weekdayOf } from '../utils/date'
import TaskDetail from './TaskDetail'
import DatePicker from './DatePicker'
import TagPicker from './TagPicker'
import MarkdownEditor from './MarkdownEditor'
import SubtaskEditor from './SubtaskEditor'

interface DayViewProps {
  date: string
  tags: Tag[]
  selectedTaskId: string | null
  onSelectTask: (id: string | null) => void
  onDateChange: (date: string) => void
  onTasksChanged: () => void
  onStatus: (msg: string) => void
  onGoToTags: () => void
}

export default function DayView({
  date,
  tags,
  selectedTaskId,
  onSelectTask,
  onDateChange,
  onTasksChanged,
  onStatus,
  onGoToTags
}: DayViewProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [isRest, setIsRest] = useState(false)

  // 编辑模式（行内，非弹窗）
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editTags, setEditTags] = useState<string[]>([])
  const [editSubtasks, setEditSubtasks] = useState<Subtask[]>([])
  const [editNote, setEditNote] = useState('')

  const tagMap = new Map(tags.map((t) => [t.id, t]))

  async function loadTasks(): Promise<void> {
    const all = await window.api.readTasks(date)
    setTasks(all)
    if (!all.some((t) => t.id === selectedTaskId)) {
      onSelectTask(all.length > 0 ? all[0].id : null)
    }
  }

  useEffect(() => {
    let cancelled = false
    setTasks([])
    setEditingTask(null)
    window.api.readTasks(date).then((all) => {
      if (cancelled) return
      setTasks(all)
      if (!all.some((t) => t.id === selectedTaskId)) {
        onSelectTask(all.length > 0 ? all[0].id : null)
      }
    })
    window.api.isRest(date).then((r) => {
      if (!cancelled) setIsRest(r)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  const selected = tasks.find((t) => t.id === selectedTaskId) ?? null

  async function toggleTask(id: string): Promise<void> {
    const target = tasks.find((t) => t.id === id)
    if (!target) return
    const nextDone = !target.done
    setTasks((prev) =>
      [...prev]
        .map((x) => (x.id === id ? { ...x, done: nextDone, completedAt: nextDone ? new Date().toISOString() : null } : x))
        .sort((a, b) => (a.done !== b.done ? (a.done ? 1 : -1) : a.order - b.order))
    )
    await window.api.updateTask(date, id, { done: nextDone })
    onTasksChanged()
    onStatus(nextDone ? '已标记完成' : '已取消完成')
  }

  async function toggleSubtask(taskId: string, subtaskId: string): Promise<void> {
    const target = tasks.find((t) => t.id === taskId)
    if (!target) return
    const nextSubtasks = target.subtasks.map((st) =>
      st.id === subtaskId ? { ...st, done: !st.done } : st
    )
    setTasks((prev) => prev.map((x) => (x.id === taskId ? { ...x, subtasks: nextSubtasks } : x)))
    await window.api.updateTask(date, taskId, { subtasks: nextSubtasks })
    onTasksChanged()
  }

  async function toggleRest(v: boolean): Promise<void> {
    setIsRest(v)
    await window.api.setRest(date, v)
    onStatus(v ? '已标记休息日' : '已取消休息日')
  }

  function openEdit(task: Task): void {
    setEditingTask(task)
    setEditTitle(task.title)
    setEditBody(task.body)
    setEditTags(task.tags)
    setEditSubtasks(task.subtasks ?? [])
    setEditNote(task.note ?? '')
  }

  function cancelEdit(): void {
    setEditingTask(null)
  }

  async function saveEdit(): Promise<void> {
    if (!editingTask) return
    if (!editTitle.trim()) {
      onStatus('请填写任务标题')
      return
    }
    await window.api.updateTask(date, editingTask.id, {
      title: editTitle.trim(),
      body: editBody,
      tags: editTags,
      subtasks: editSubtasks,
      note: editNote
    })
    setEditingTask(null)
    onTasksChanged()
    onStatus('已保存（所有天同步）')
    await loadTasks()
  }

  async function delTask(task: Task): Promise<void> {
    if (
      window.confirm(
        `删除任务「${task.title}」？若该任务被派发到多天，所有天的该任务都会被一并移入临时回收站。`
      )
    ) {
      await window.api.trashTask(date, task.id)
      onTasksChanged()
      onStatus('已移入回收站')
      await loadTasks()
    }
  }

  const isEditing = editingTask !== null && selected !== null && editingTask.id === selected.id

  return (
    <div className="day-view">
      <div className="day-panel">
        <div className="date-heading">
          <DatePicker value={date} onChange={onDateChange} title="选择日期" />
          <span className="weekday">{weekdayOf(date)}</span>
          {tasks.length > 0 ? <span className="badge">已记录</span> : <span className="badge new">未填写</span>}
          <label className="rest-toggle" title="标记为休息日">
            <input type="checkbox" checked={isRest} onChange={(e) => toggleRest(e.target.checked)} />
            休息日
          </label>
        </div>
        <div className="day-columns">
          <div className="day-list">
            {tasks.length === 0 ? (
              <div className="task-empty">当天暂无任务，请在「任务发布」中发布</div>
            ) : (
              tasks.map((t) => (
                <div
                  key={t.id}
                  className={
                    'task-item' +
                    (t.id === selectedTaskId ? ' selected' : '') +
                    (t.done ? ' done' : '')
                  }
                  onClick={() => onSelectTask(t.id)}
                >
                  <div className="task-item-main">
                    <input
                      type="checkbox"
                      className="task-check"
                      checked={t.done}
                      onChange={() => toggleTask(t.id)}
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
                  {(t.subtasks ?? []).length > 0 && (
                    <div className="task-subtasks" onClick={(e) => e.stopPropagation()}>
                      {(t.subtasks ?? []).map((st) => (
                        <div key={st.id} className={'task-subtask' + (st.done ? ' done' : '')}>
                          <input
                            type="checkbox"
                            className="task-check"
                            checked={st.done}
                            onChange={() => toggleSubtask(t.id, st.id)}
                          />
                          <span className="task-subtask-title">{st.title || '（未命名）'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="task-times muted">
                    <span>📅 派发于 {new Date(t.publishedAt).toLocaleString()}</span>
                    {t.completedAt && (
                      <span>✅ 完成于 {new Date(t.completedAt).toLocaleString()}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="day-detail">
            {selected ? (
              isEditing ? (
                <div className="task-edit-form">
                  <div className="detail-actions">
                    <button className="icon-btn primary" onClick={saveEdit} title="保存（所有天同步）">
                      💾
                    </button>
                    <button className="icon-btn" onClick={cancelEdit} title="取消">
                      ✕
                    </button>
                  </div>
                  <input
                    className="publish-title"
                    placeholder="任务标题"
                    value={editTitle}
                    autoFocus
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                  <TagPicker
                    selectedIds={editTags}
                    allTags={tags}
                    onChange={setEditTags}
                    onGoToTags={onGoToTags}
                  />
                  <div className="subtask-editor">
                    <SubtaskEditor subtasks={editSubtasks} tags={tags} onChange={setEditSubtasks} />
                  </div>
                  <div className="task-note">
                    <div className="task-note-label">📝 备注</div>
                    <textarea
                      className="task-note-input"
                      placeholder="给这个任务简单备注…（保存后随任务在所有天共享）"
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value)}
                    />
                  </div>
                  <div className="publish-body">
                    <MarkdownEditor
                      value={editBody}
                      onChange={setEditBody}
                      attachFolder="publish"
                      onStatus={onStatus}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="detail-actions">
                    <button className="icon-btn" onClick={() => openEdit(selected)} title="编辑任务（所有天同步）">
                      ✏️
                    </button>
                    <button className="icon-btn danger" onClick={() => delTask(selected)} title="删除任务（进回收站，所有天同步）">
                      🗑
                    </button>
                  </div>
                  <TaskDetail task={selected} date={date} tags={tags} />
                </>
              )
            ) : (
              <div className="task-empty">选择左侧任务查看详情</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
