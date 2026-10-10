import { useEffect, useRef, useState } from 'react'
import {
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  PenLine,
  Square,
  StickyNote
} from 'lucide-react'
import type { StatusReporter, Tag, Task, WeekInfo } from '../types'
import { toDateStr, weekdayOf, weekInfoOf } from '../utils/date'
import MarkdownEditor from './MarkdownEditor'
import RichView from './RichView'
import Drawer from './Drawer'
import DatePicker from './DatePicker'
import Modal from './Modal'
import TagBadgeList from './TagBadge'

interface WeeklyViewProps {
  weekKey: string
  tags: Tag[]
  onWeekChange: (weekKey: string) => void
  onStatus: StatusReporter
  /** 数据变更版本号：变化时重新拉取本周任务 */
  dataVersion?: number
}

const tagById = (tags: Tag[]) => new Map(tags.map((t) => [t.id, t]))

function DayBlock({
  date,
  tasks,
  tags,
  onOpenTask
}: {
  date: string
  tasks: Task[]
  tags: Tag[]
  onOpenTask: (task: Task) => void
}) {
  const tagMap = tagById(tags)
  return (
    <div className="weekly-day">
      <div className="weekly-day-head">
        <span className="weekly-day-date">{date}</span>
        <span className="weekly-day-weekday">{weekdayOf(date)}</span>
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
                  <TagBadgeList ids={t.tags} tagMap={tagMap} />
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

export default function WeeklyView({
  weekKey,
  tags,
  onWeekChange,
  onStatus,
  dataVersion = 0
}: WeeklyViewProps) {
  const [info, setInfo] = useState<WeekInfo | null>(null)
  const [tasksByDate, setTasksByDate] = useState<Record<string, Task[]>>({})
  const [summary, setSummary] = useState('')
  const [summaryLoaded, setSummaryLoaded] = useState(false)
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [showSummary, setShowSummary] = useState(false)
  const summaryTimer = useRef<number | null>(null)
  /** 尚未落盘的周总结草稿（防抖期间的值） */
  const pendingSummary = useRef<string | null>(null)

  // 任务数据：周切换或数据变更时重新拉取
  useEffect(() => {
    let cancelled = false
    window.api.getWeekInfoByKey(weekKey).then(async (wi) => {
      if (cancelled || !wi) return
      setInfo(wi)
      const map = await window.api.readTasksMany(wi.dates)
      if (cancelled) return
      setTasksByDate(map)
    })
    return () => {
      cancelled = true
    }
  }, [weekKey, dataVersion])

  // 周总结：**只在周切换时载入** —— 若跟着 dataVersion 一起重载，
  // 会把用户正在输入、尚未落盘的草稿覆盖掉。
  useEffect(() => {
    let cancelled = false
    setSummaryLoaded(false)
    window.api.readWeeklySummary(weekKey).then((s) => {
      if (cancelled) return
      setSummary(s.summary)
      setSummaryLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [weekKey])

  /** 把防抖中的周总结立即写入（切周 / 卸载时调用，避免丢失最后 800ms 的输入） */
  function flushSummary(wk: string): void {
    if (summaryTimer.current !== null) {
      window.clearTimeout(summaryTimer.current)
      summaryTimer.current = null
    }
    if (pendingSummary.current !== null) {
      const text = pendingSummary.current
      pendingSummary.current = null
      void window.api.writeWeeklySummary(wk, text)
    }
  }

  // 切周或卸载时把未落盘内容写入（cleanup 捕获的是**切换前**的 weekKey）
  useEffect(() => {
    return () => flushSummary(weekKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey])

  function changeSummary(md: string): void {
    setSummary(md)
    pendingSummary.current = md
    if (summaryTimer.current !== null) window.clearTimeout(summaryTimer.current)
    summaryTimer.current = window.setTimeout(() => {
      summaryTimer.current = null
      const text = pendingSummary.current ?? ''
      pendingSummary.current = null
      void window.api.writeWeeklySummary(weekKey, text)
    }, 800)
  }

  async function shift(delta: number): Promise<void> {
    const wk = await window.api.shiftWeekKey(weekKey, delta)
    if (wk) onWeekChange(wk)
  }

  function goThisWeek(): void {
    onWeekChange(weekInfoOf(toDateStr(new Date())).weekKey)
  }

  return (
    <div className="weekly-view">
      <div className="weekly-head">
        <button className="week-nav" onClick={() => shift(-1)} title="上一周" aria-label="上一周">
          ‹
        </button>
        <div className="weekly-title">
          {info ? `第 ${info.week} 周（${info.start} ~ ${info.end}）` : weekKey}
          <span className="week-key">{weekKey}</span>
        </div>
        <button className="week-nav" onClick={() => shift(1)} title="下一周" aria-label="下一周">
          ›
        </button>
        <DatePicker
          value={info ? info.start : ''}
          onChange={(v) => onWeekChange(weekInfoOf(v).weekKey)}
          title="选择日期，跳到所在周"
        />
        <button className="week-today" onClick={goThisWeek}>
          回到本周
        </button>
      </div>

      <div className="weekly-days">
        {info
          ? info.dates.map((d) => (
              <DayBlock
                key={d}
                date={d}
                tasks={tasksByDate[d] ?? []}
                tags={tags}
                onOpenTask={setDetailTask}
              />
            ))
          : null}
      </div>

      <div className="weekly-summary">
        <div className="weekly-summary-head">
          <h3>周总结</h3>
          <button className="ghost-btn" onClick={() => setShowSummary(true)}>
            <PenLine size={14} />
            填写周报总结
          </button>
        </div>
        {summaryLoaded ? (
          summary.trim() ? (
            <RichView content={summary} />
          ) : (
            <div className="task-empty">本周总结未填写，点击「填写周报总结」开始</div>
          )
        ) : (
          <div className="loading">加载中…</div>
        )}
      </div>

      <Modal open={showSummary} title="填写周报总结" width={760} onClose={() => setShowSummary(false)}>
        <div className="weekly-summary-editor">
          <MarkdownEditor
            value={summary}
            onChange={changeSummary}
            attachFolder={weekKey}
            onStatus={onStatus}
            placeholder="在此填写本周工作总结（Markdown）…"
          />
        </div>
      </Modal>

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
              <TagBadgeList ids={detailTask.tags} tagMap={tagById(tags)} />
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
