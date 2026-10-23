import { useEffect, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import Calendar from './Calendar'
import type { Task } from '../types'
import { toDateStr, weekdayOf } from '../utils/date'

interface CalendarViewProps {
  /** 当前选中的日期（跟着日报页共享） */
  date: string
  /** 有任务的日期集合，用于在日历上打点 */
  taskDates: Set<string>
  /** 只切换日期，不跳页 */
  onPick: (d: string) => void
  /** 跳到日报页看这一天 */
  onOpenDay: (d: string) => void
}

export default function CalendarView({
  date,
  taskDates,
  onPick,
  onOpenDay
}: CalendarViewProps): React.JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([])

  useEffect(() => {
    let cancelled = false
    window.api.readTasks(date).then((all) => {
      if (!cancelled) setTasks(all)
    })
    return () => {
      cancelled = true
    }
  }, [date])

  const done = tasks.filter((t) => t.done).length

  return (
    <div className="cal-view">
      <header className="workhead">
        <div className="wh-left">
          <span className="wh-title">日历</span>
          <span className="wh-sub">点选日期查看当天任务</span>
        </div>
        <div className="wh-right">
          <button className="btn btn--sm" onClick={() => onPick(toDateStr(new Date()))}>
            回到今天
          </button>
          <button className="btn btn--sm btn--primary" onClick={() => onOpenDay(date)}>
            打开日报
          </button>
        </div>
      </header>

      <div className="workscroll">
        <div className="cal-layout">
          <div className="card cal-card">
            <Calendar selected={date} markers={taskDates} onSelect={onPick} />
          </div>

          <div className="card cal-side">
            <div className="cal-side-head">
              <h3>
                <CalendarDays size={14} />
                {date} {weekdayOf(date)}
              </h3>
              <span className="muted num">
                {tasks.length} 个任务 · 完成 {done}
              </span>
            </div>

            {tasks.length === 0 ? (
              <div className="empty-state">
                这天还没有任务，去「任务发布」里发布，或直接从日历上换一天。
              </div>
            ) : (
              <ul className="cal-tasklist">
                {tasks.map((t) => (
                  <li key={t.id} className={t.done ? 'done' : ''}>
                    <span className="cbox-dot" />
                    <span className="t">{t.title || '未命名任务'}</span>
                    {t.subtasks.length > 0 && (
                      <span className="m num">
                        {t.subtasks.filter((s) => s.done).length}/{t.subtasks.length}
                      </span>
                    )}
                    {t.tags.length > 0 && <span className="m num">{t.tags.length} 标签</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
