import { useEffect, useRef, useState } from 'react'
import {
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  PenLine,
  Square,
  StickyNote
} from 'lucide-react'
import type { Tag, Task, WeekInfo } from '../types'
import { toDateStr, weekdayOf, weekInfoOf } from '../utils/date'
import MarkdownEditor from './MarkdownEditor'
import RichView from './RichView'
import Drawer from './Drawer'
import DatePicker from './DatePicker'
import Modal from './Modal'

interface WeeklyViewProps {
  weekKey: string
  tags: Tag[]
  onWeekChange: (weekKey: string) => void
  onStatus: (msg: string) => void
}

const tagById = (tags: Tag[]) => new Map(tags.map((t) => [t.id, t]))

function DayBlock({
  date,
  tasks,
  tags,
  isRest,
  onOpenTask
}: {
  date: string
  tasks: Task[]
  tags: Tag[]
  isRest: boolean
  onOpenTask: (task: Task) => void
}) {
  const tagMap = tagById(tags)
  return (
    <div className="weekly-day">
      <div className="weekly-day-head">
        <span className="weekly-day-date">{date}</span>
        <span className="weekly-day-weekday">{weekdayOf(date)}</span>
        {isRest && <span className="weekly-rest">休息日</span>}
      </div>
      {tasks.length === 0 ? (
        <div className="weekly-day-empty">无任务</div>
      ) : (
        <ul className="weekly-day-tasks">
          {tasks.map((t) => (
            <li
              key={t.id}
              className={'weekly-task' + (t.done ? ' done' : '')}
              onClick={() => onOpenTask(t)}
              title="查看任务详情"
            >
              <div className="weekly-task-main">
                <span className="weekly-check">{t.done ? <CheckSquare size={14} /> : <Square size={14} />}</span>
                <span className="weekly-task-title">{t.title}</span>
                <span className="weekly-task-done-at muted">
                  派发 {new Date(t.publishedAt).toLocaleString()}
                </span>
                {t.completedAt && (
                  <span className="weekly-task-done-at muted">
                    完成于 {new Date(t.completedAt).toLocaleString()}
                  </span>
                )}
                <span className="weekly-task-tags">
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
                <div className="weekly-subtasks">
                  {(t.subtasks ?? []).map((st) => (
                    <div key={st.id} className={'weekly-subtask' + (st.done ? ' done' : '')}>
                      <span className="weekly-check">{st.done ? <CheckSquare size={14} /> : <Square size={14} />}</span>
                      <span className="weekly-subtask-title">{st.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function WeeklyView({ weekKey, tags, onWeekChange, onStatus }: WeeklyViewProps) {
  const [info, setInfo] = useState<WeekInfo | null>(null)
  const [tasksByDate, setTasksByDate] = useState<Record<string, Task[]>>({})
  const [restSet, setRestSet] = useState<Set<string>>(new Set())
  const [summary, setSummary] = useState('')
  const [summaryLoaded, setSummaryLoaded] = useState(false)
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [showSummary, setShowSummary] = useState(false)
  const summaryTimer = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setSummaryLoaded(false)
    window.api.getWeekInfoByKey(weekKey).then(async (wi) => {
      if (cancelled || !wi) return
      setInfo(wi)
      const map = await window.api.readTasksMany(wi.dates)
      if (cancelled) return
      setTasksByDate(map)
      const rest = new Set<string>()
      for (const d of wi.dates) {
        if (await window.api.isRest(d)) rest.add(d)
      }
      if (cancelled) return
      setRestSet(rest)
    })
    window.api.readWeeklySummary(weekKey).then((s) => {
      if (cancelled) return
      setSummary(s.summary)
      setSummaryLoaded(true)
    })
    return () => {
      cancelled = true
      if (summaryTimer.current !== null) window.clearTimeout(summaryTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey])

  function changeSummary(md: string): void {
    setSummary(md)
    if (summaryTimer.current !== null) window.clearTimeout(summaryTimer.current)
    summaryTimer.current = window.setTimeout(() => {
      window.api.writeWeeklySummary(weekKey, md)
    }, 800)
  }

  async function shift(delta: number): Promise<void> {
    const wk = await window.api.shiftWeekKey(weekKey, delta)
    if (wk) onWeekChange(wk)
  }

  /** 侧栏：最近 6 周（按当前周往前推，用 weekInfoOf 同步算，不额外打 IPC） */
  const weekBase = info ? new Date(info.start + 'T00:00:00') : new Date()
  const weeks = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(weekBase)
    d.setDate(weekBase.getDate() - 7 * i)
    return weekInfoOf(toDateStr(d))
  })

  const allTasks = Object.values(tasksByDate).flat()
  const taskStats = {
    total: allTasks.length,
    done: allTasks.filter((t) => t.done).length,
    rate: allTasks.length ? Math.round((allTasks.filter((t) => t.done).length / allTasks.length) * 100) : 0
  }

  function goThisWeek(): void {
    onWeekChange(weekInfoOf(toDateStr(new Date())).weekKey)
  }

  return (
    <div className="weekly-view">
      <header className="workhead">
        <div className="wh-left">
          <button className="btn btn--icon btn--sm" onClick={() => shift(-1)} title="上一周">
            ‹
          </button>
          <span className="wh-title">{info ? `第 ${info.week} 周` : weekKey}</span>
          <span className="wh-sub">{info ? `${info.start} – ${info.end}` : ''}</span>
          <button className="btn btn--icon btn--sm" onClick={() => shift(1)} title="下一周">
            ›
          </button>
        </div>
        <div className="wh-right">
          <DatePicker
            value={info ? info.start : ''}
            onChange={(v) => onWeekChange(weekInfoOf(v).weekKey)}
            title="选择日期，跳到所在周"
          />
          <button className="btn btn--sm" onClick={goThisWeek}>
            回到本周
          </button>
        </div>
      </header>

      <div className="with-side">
        <aside className="page-side">
          <div className="ps-head">
            <span>周次</span>
            <span className="ps-count">6</span>
          </div>
          <div className="ps-list">
            {weeks.map((w) => (
              <button
                key={w.weekKey}
                className={'ps-item' + (w.weekKey === weekKey ? ' on' : '')}
                onClick={() => onWeekChange(w.weekKey)}
              >
                <span className="ps-item-name">第 {w.week} 周</span>
                <span className="ps-item-meta">
                  {w.start.slice(5)}–{w.end.slice(5)}
                </span>
              </button>
            ))}
          </div>

          <div className="ps-head">
            <span>本周概览</span>
          </div>
          <div className="ps-kv">
            <span>任务</span>
            <b>{taskStats.total}</b>
          </div>
          <div className="ps-kv">
            <span>已完成</span>
            <b>{taskStats.done}</b>
          </div>
          <div className="ps-kv">
            <span>完成率</span>
            <b>{taskStats.rate}%</b>
          </div>
        </aside>

        <div className="page-main">
          <div className="workscroll">
            <div className="weekly-days">
              {info
                ? info.dates.map((d) => (
                    <DayBlock
                      key={d}
                      date={d}
                      tasks={tasksByDate[d] ?? []}
                      tags={tags}
                      isRest={restSet.has(d)}
                      onOpenTask={setDetailTask}
                    />
                  ))
                : null}
            </div>

            <div className="weekly-summary">
              <div className="weekly-summary-head">
                <h3>周总结</h3>
                <span className="muted">{summary.trim() ? '自动保存' : ''}</span>
              </div>
              {summaryLoaded ? (
                <MarkdownEditor
                  value={summary}
                  onChange={changeSummary}
                  attachFolder={weekKey}
                  onStatus={onStatus}
                  placeholder=""
                />
              ) : (
                <div className="loading">加载中…</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Drawer
        open={detailTask !== null}
        title="任务详情"
        onClose={() => setDetailTask(null)}
      >
        {detailTask && (
          <div className="publish-detail">
            <h3 className="publish-detail-title">{detailTask.title || '未命名任务'}</h3>
            <div className="task-time-info">
              <span>
                <CalendarDays size={13} />
                派发：{new Date(detailTask.publishedAt).toLocaleString()}
              </span>
              {detailTask.completedAt && (
                <span>
                  <CheckCircle2 size={13} />
                  完成：{new Date(detailTask.completedAt).toLocaleString()}
                </span>
              )}
            </div>
            <div className="tag-chips">
              {detailTask.tags.map((id) => {
                const t = tagById(tags).get(id)
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
              {detailTask.tags.length === 0 && <span className="muted">（无标签）</span>}
            </div>
            {(detailTask.subtasks ?? []).length > 0 && (
              <div className="subtask-list read">
                {(detailTask.subtasks ?? []).map((st) => (
                  <div key={st.id} className={'subtask-row' + (st.done ? ' done' : '')}>
                    <span className="subtask-check">{st.done ? <CheckSquare size={13} /> : <Square size={13} />}</span>
                    <span className="subtask-title">{st.title}</span>
                  </div>
                ))}
              </div>
            )}
            {(detailTask.note && detailTask.note.trim()) && (
              <div className="task-note">
                <div className="task-note-label">
                  <StickyNote size={13} />
                  备注
                </div>
                <div className="task-note-view">{detailTask.note}</div>
              </div>
            )}
            {detailTask.body ? (
              <RichView content={detailTask.body} />
            ) : (
              <div className="task-empty">暂无正文</div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  )
}
