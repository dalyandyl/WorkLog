import { useEffect, useState } from 'react'
import type { Tag, Task } from '../types'
import { weekdayOf } from '../utils/date'
import TaskDetail from './TaskDetail'
import DatePicker from './DatePicker'

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

  const tagMap = new Map(tags.map((t) => [t.id, t]))

  useEffect(() => {
    let cancelled = false
    setTasks([])
    window.api.readTasks(date).then((all) => {
      if (cancelled) return
      const filtered = all
      setTasks(filtered)
      if (!filtered.some((t) => t.id === selectedTaskId)) {
        onSelectTask(filtered.length > 0 ? filtered[0].id : null)
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
              <div className="task-empty">当天暂无该项目的任务，请在「任务发布」中发布</div>
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
              <TaskDetail task={selected} date={date} tags={tags} />
            ) : (
              <div className="task-empty">选择左侧任务查看详情</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
