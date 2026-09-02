import { useEffect, useState } from 'react'
import type { MonthStats } from '../types'
import DatePicker from './DatePicker'

interface StatsViewProps {
  /** 初始区间基准（取其年月构造当月区间） */
  date: string
}

function monthRange(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

export default function StatsView({ date }: StatsViewProps) {
  const [y, m] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))]
  const [range, setRange] = useState(() => monthRange(y, m))
  const [stats, setStats] = useState<MonthStats | null>(null)

  function gotoMonth(delta: number): void {
    const base = new Date(Number(range.start.slice(0, 4)), Number(range.start.slice(5, 7)) - 1 + delta, 1)
    setRange(monthRange(base.getFullYear(), base.getMonth() + 1))
  }

  function thisMonth(): void {
    const now = new Date()
    setRange(monthRange(now.getFullYear(), now.getMonth() + 1))
  }

  useEffect(() => {
    setRange(monthRange(y, m))
  }, [y, m])

  useEffect(() => {
    let cancelled = false
    window.api.rangeStats(range.start, range.end).then((s) => {
      if (!cancelled) setStats(s)
    })
    return () => {
      cancelled = true
    }
  }, [range.start, range.end])

  if (!stats) return <div className="loading">统计中…</div>

  const maxDaily = Math.max(1, ...stats.daily.map((d) => d.taskCount))
  const rate = stats.totalTasks > 0 ? Math.round((stats.doneTasks / stats.totalTasks) * 100) : 0

  const anchorMonth = monthRange(Number(range.start.slice(0, 4)), Number(range.start.slice(5, 7)))

  return (
    <div className="stats-view">
      <div className="stats-head">
        <button className="week-nav" onClick={() => gotoMonth(-1)} title="上个月">
          ‹
        </button>
        <DatePicker
          value={range.start}
          label={`${range.start.slice(0, 7)} 月度`}
          onChange={(v) => setRange(monthRange(Number(v.slice(0, 4)), Number(v.slice(5, 7))))}
          title="点击选择月份（日历中可选年/月）"
        />
        <button className="week-nav" onClick={() => gotoMonth(1)} title="下个月">
          ›
        </button>
        <button className="week-today" onClick={thisMonth}>
          本月
        </button>
        <span className="stats-range-label">自定义区间（限当月）：</span>
        <DatePicker
          value={range.start}
          minDate={anchorMonth.start}
          maxDate={anchorMonth.end}
          onChange={(v) => setRange((r) => ({ ...r, start: v <= r.end ? v : r.start }))}
          title="区间起始日期"
        />
        <span>至</span>
        <DatePicker
          value={range.end}
          minDate={anchorMonth.start}
          maxDate={anchorMonth.end}
          onChange={(v) => setRange((r) => ({ ...r, end: v >= r.start ? v : r.end }))}
          title="区间结束日期"
        />
      </div>

      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-num">{stats.daysWithTasks}</div>
          <div className="stat-label">
            记录天数 / {stats.totalDays}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{stats.totalTasks}</div>
          <div className="stat-label">任务总数</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{stats.doneTasks}</div>
          <div className="stat-label">已完成</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{rate}%</div>
          <div className="stat-label">
            完成率（{stats.pendingTasks} 未完成）
          </div>
        </div>
      </div>

      <div className="stat-section">
        <h3>
          每日任务量（{range.start} ~ {range.end}）
        </h3>
        <div className="month-chart">
          <div className="chart-y" aria-hidden>
            <span>{maxDaily}</span>
            <span>{Math.ceil(maxDaily / 2)}</span>
            <span>0</span>
          </div>
          <div className="month-bars">
            {stats.daily.map((d) => {
              const height = d.taskCount > 0 ? Math.max(12, (d.taskCount / maxDaily) * 64) : 3
              const allDone = d.taskCount > 0 && d.doneCount === d.taskCount
              return (
                <div
                  key={d.date}
                  className={'month-bar' + (d.taskCount > 0 ? ' has' : '')}
                  title={`${d.date}：${d.taskCount} 个任务，完成 ${d.doneCount}`}
                >
                  <span className={'month-bar-num' + (d.taskCount > 0 ? '' : ' zero')}>
                    {d.taskCount > 0 ? d.taskCount : ''}
                  </span>
                  <div
                    className={allDone ? 'month-bar-fill done-all' : 'month-bar-fill'}
                    style={{ height: `${height}px` }}
                  />
                  <span className="month-bar-day">{d.day}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="stat-section">
        <h3>标签分布</h3>
        {stats.tagCounts.length === 0 ? (
          <div className="muted">暂无标签</div>
        ) : (
          <div className="tag-cards">
            {stats.tagCounts.map((t) => (
              <div key={t.tagId} className="tag-card">
                <span className="tag-dot" style={{ background: t.color }} />
                <span className="tag-card-name" style={{ color: t.color }}>
                  {t.name}
                </span>
                <span className="tag-card-count">×{t.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
