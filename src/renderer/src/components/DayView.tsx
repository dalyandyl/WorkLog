import { confirmDialog } from './confirm'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  ListTree,
  PinOff,
  StickyNote as StickyNoteIcon,
  Trash2
} from 'lucide-react'
import type { StickyNote, Tag, Task } from '../types'
import { toDateStr, weekdayOf } from '../utils/date'
import { TaskDetailAside, bodyChars } from './TaskDetail'
import DatePicker from './DatePicker'
import TagPicker from './TagPicker'
import PostponeModal from './PostponeModal'

// 正文富文本编辑器较重（TipTap + lowlight），懒加载；自带 Suspense 边界，避免整页被替换
const RichBodyEditor = lazy(() => import('./RichBodyEditor'))

interface DayViewProps {
  date: string
  /** 外部改动任务后递增，用来触发重新加载 */
  reloadKey?: number
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
  reloadKey,
  onStatus,
  onGoToTags
}: DayViewProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  // 置顶且未完成的便签（显示在任务列表上方）
  const [stickyNotes, setStickyNotes] = useState<StickyNote[]>([])
  // 延期弹窗当前任务（null = 关闭）
  const [postponeTask, setPostponeTask] = useState<Task | null>(null)
  // 切日期时保持旧内容并淡出，避免「空态闪一下」和栏宽跳动
  const [loading, setLoading] = useState(false)

  // 自动保存状态（没有「保存」按钮：改动停手 700ms 就写盘）
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const pending = useRef<{ date: string; id: string; patch: Record<string, unknown> } | null>(null)
  const saveTimer = useRef<number | null>(null)

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
    setLoading(true)
    window.api.readTasks(date).then((all) => {
      if (cancelled) return
      setTasks(all)
      setLoading(false)
      if (!all.some((t) => t.id === selectedTaskId)) {
        onSelectTask(all.length > 0 ? all[0].id : null)
      }
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })
    // 便签与日期无关，每次进入日报重新拉取，保证与便签页状态同步
    window.api.listStickyNotes().then((all) => {
      if (cancelled) return
      setStickyNotes(all.filter((n) => n.pinned && !n.completed))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, reloadKey])

  /** 日报便签区：标记完成（从日报消失） */
  async function completeSticky(n: StickyNote): Promise<void> {
    setStickyNotes((prev) => prev.filter((x) => x.id !== n.id))
    await window.api.updateStickyNote(n.id, { completed: true })
    onStatus('已标记完成，便签移出日报')
  }

  /** 日报便签区：取消置顶（从日报消失） */
  async function unpinSticky(n: StickyNote): Promise<void> {
    setStickyNotes((prev) => prev.filter((x) => x.id !== n.id))
    await window.api.updateStickyNote(n.id, { pinned: false })
    onStatus('已取消置顶，便签移出日报')
  }

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

  /** 合并同一任务的连续改动，停手 700ms 后写盘（编辑态常驻，没有「保存」按钮） */
  function queueSave(id: string, patch: Record<string, unknown>): void {
    pending.current = {
      date,
      id,
      patch: {
        ...(pending.current && pending.current.id === id ? pending.current.patch : {}),
        ...patch
      }
    }
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void flushSave(), 700)
  }

  async function flushSave(): Promise<void> {
    const p = pending.current
    pending.current = null
    if (!p) return
    setSaving(true)
    try {
      await window.api.updateTask(p.date, p.id, p.patch)
      setSavedAt(
        new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      )
    } finally {
      setSaving(false)
    }
  }

  // 切日期 / 关闭页面之前，把还没写盘的改动落下去
  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      void flushSave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 当前任务改一个字段：先改本地（立刻看到），再排队写盘（所有天同步） */
  function patchSelected(patch: Partial<Task>): void {
    if (!selected) return
    setTasks((prev) => prev.map((t) => (t.id === selected.id ? { ...t, ...patch } : t)))
    queueSave(selected.id, patch as Record<string, unknown>)
  }

  async function delTask(task: Task): Promise<void> {
    if (
      await confirmDialog(
        `删除任务「${task.title}」？若该任务被派发到多天，所有天的该任务都会被一并移入临时回收站。`
      )
    ) {
      await window.api.trashTask(date, task.id)
      onTasksChanged()
      onStatus('已移入回收站')
      await loadTasks()
    }
  }

  function shiftDate(delta: number): void {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() + delta)
    onDateChange(toDateStr(d))
  }

  return (
    <div className="day-view">
      <header className="workhead">
        <div className="wh-left">
          <button className="btn btn--icon btn--sm" onClick={() => shiftDate(-1)} title="前一天">
            <ChevronLeft />
          </button>
          <div className="datechip">
            <DatePicker value={date} onChange={onDateChange} title="选择日期" />
            <span className="wh-sub">{weekdayOf(date)}</span>
          </div>
          <button className="btn btn--icon btn--sm" onClick={() => shiftDate(1)} title="后一天">
            <ChevronRight />
          </button>
          <button className="btn btn--sm" onClick={() => onDateChange(toDateStr(new Date()))}>
            今天
          </button>
          <span className={'pill ' + (tasks.length > 0 ? 'pill--ok' : 'pill--warn')}>
            <i />
            {tasks.length > 0 ? '已记录' : '未填写'}
          </span>
        </div>
        <div className="wh-right">

          {selected && (
            <>
              {!selected.done && (
                <button className="btn btn--sm" onClick={() => setPostponeTask(selected)}>
                  <CalendarClock />
                  延期
                </button>
              )}
              <button
                className="btn btn--sm btn--danger"
                onClick={() => delTask(selected)}
                title="删除任务（进回收站，所有天同步）"
              >
                <Trash2 />
                删除
              </button>
            </>
          )}
        </div>
      </header>

      <div className="workscroll">
        <div className={'daygrid' + (loading ? ' is-loading' : '')}>
          {/* 当天任务列表（原上下文栏里的那份） */}
          <div className="daylist">
            <div className="dl-head">
              <span>当天任务</span>
              <b>
                {tasks.filter((t) => t.done).length}/{tasks.length}
              </b>
            </div>
            {tasks.length === 0 && <div className="dl-empty">当天还没有任务</div>}
            {tasks.map((t) => (
              <div
                key={t.id}
                className={'dli' + (selected?.id === t.id ? ' on' : '')}
                onClick={() => onSelectTask(t.id)}
                title={t.title}
              >
                <button
                  className={'cbox' + (t.done ? ' on' : '')}
                  title={t.done ? '取消完成' : '标记完成'}
                  onClick={(e) => {
                    e.stopPropagation()
                    void toggleTask(t.id)
                  }}
                >
                  <Check />
                </button>
                <span
                  className="t"
                  style={t.done ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}
                >
                  {t.title}
                </span>
                {t.subtasks.length > 0 && (
                  <span className="m">
                    {t.subtasks.filter((s) => s.done).length}/{t.subtasks.length}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="daymain">
            {stickyNotes.length > 0 && (
              <div className="card notestrip">
                <div className="cardhead">
                  <div className="cardtitle">
                    <StickyNoteIcon />
                    置顶便签
                  </div>
                  <span className="pill">{stickyNotes.length}</span>
                </div>
                {stickyNotes.map((n) => (
                  <div key={n.id} className="noteitem">
                    <button className="cbox" title="标记完成" onClick={() => completeSticky(n)}>
                      <Check />
                    </button>
                    <span className="txt" title={n.text}>
                      {n.text}
                    </span>
                    <button className="icobtn" title="取消置顶（移出日报）" onClick={() => unpinSticky(n)}>
                      <PinOff size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!selected && (
              <div className="empty-state">
                <ListTree />
                <div>{tasks.length === 0 ? '当天暂无任务，请在「任务发布」中发布' : '选择左侧任务查看详情'}</div>
              </div>
            )}

            {selected && (
              <div className="card taskcard taskcard--edit">
                <div className="td-head">
                  <input
                    className="td-title-input"
                    value={selected.title}
                    placeholder="任务标题"
                    onChange={(e) => patchSelected({ title: e.target.value })}
                    onBlur={() => {
                      if (!selected.title.trim()) patchSelected({ title: '未命名任务' })
                    }}
                  />
                  <span className={'pill ' + (selected.done ? 'pill--ok' : 'pill--accent')}>
                    <i />
                    {selected.done ? '已完成' : '进行中'}
                  </span>
                </div>

                <div className="td-tags">
                  <TagPicker
                    selectedIds={selected.tags}
                    allTags={tags}
                    onChange={(ids) => patchSelected({ tags: ids })}
                    onGoToTags={onGoToTags}
                  />
                </div>

                <div className="td-body">
                  <Suspense fallback={<div className="editor-loading">编辑器加载中…</div>}>
                    <RichBodyEditor
                      key={selected.id}
                      value={selected.body}
                      onChange={(html) => patchSelected({ body: html })}
                      attachFolder="publish"
                      onStatus={onStatus}
                    />
                  </Suspense>
                </div>

                <div className="td-foot">
                  <span>派发 {selected.publishedAt?.replace('T', ' ').slice(0, 16) || '—'}</span>
                  <span>
                    {bodyChars(selected.body)} 字
                    {saving ? ' · 保存中…' : savedAt ? ` · 已保存 ${savedAt}` : ''}
                  </span>
                </div>
              </div>
            )}
          </div>

          <aside className="dayside">
              <div className="dayside-inner">
                {selected ? (
                  <>
                    <div className="card">
                      <TaskDetailAside
                        task={selected}
                        tags={tags}
                        onToggleSubtask={(sid) => toggleSubtask(selected.id, sid)}
                        onChangeNote={(v) => patchSelected({ note: v })}
                      />
                    </div>
                    <div className="card card--pad">
                      <div className="kv" style={{ paddingTop: 0 }}>
                        <span>当天任务</span>
                        <b>
                          {tasks.filter((t) => t.done).length} / {tasks.length} 已完成
                        </b>
                      </div>
                      <div className="row" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button
                          className="btn btn--sm"
                          style={{ flex: 1 }}
                          onClick={() => toggleTask(selected.id)}
                        >
                          <Check />
                          {selected.done ? '取消完成' : '标记完成'}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="card card--pad side-empty">
                    <ListTree size={17} />
                    <p>{tasks.length === 0 ? '当天还没有任务' : '选择一个任务查看详情'}</p>
                  </div>
                )}
              </div>
            </aside>
        </div>
      </div>

      <PostponeModal
        open={postponeTask !== null}
        task={postponeTask}
        entryDate={date}
        onClose={() => setPostponeTask(null)}
        onPostponed={() => {
          void loadTasks()
          onTasksChanged()
        }}
        onStatus={onStatus}
      />
    </div>
  )
}
