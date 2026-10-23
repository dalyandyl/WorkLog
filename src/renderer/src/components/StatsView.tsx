import { useEffect, useState, type CSSProperties } from 'react'
import { BarChart3, CalendarCheck2, CheckCircle2, ListTodo, Tags, TrendingUp } from 'lucide-react'
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

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function StatsView({ date }: StatsViewProps) {
  const [y, m] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))]
  const [range, setRange] = useState(() => monthRange(y, m))
  const [stats, setStats] = useState<MonthStats | null>(null)

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
    }).catch(() => {
      if (!cancelled) setStats(null)
    })
    return () => {
      cancelled = true
    }
  }, [range.start, range.end])

  if (!stats) return <div className="loading">统计中…</div>

  const maxDaily = Math.max(1, ...stats.daily.map((d) => d.taskCount))
  const rate = stats.totalTasks > 0 ? Math.round((stats.doneTasks / stats.totalTasks) * 100) : 0

  const today = new Date()
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  const qStart = Math.floor(today.getMonth() / 3) * 3

  const presets = [
    { key: 'week', label: '本周', range: { start: iso(weekStart), end: iso(weekEnd) } },
    { key: 'month', label: '本月', range: monthRange(today.getFullYear(), today.getMonth() + 1) },
    {
      key: 'quarter',
      label: '本季',
      range: {
        start: iso(new Date(today.getFullYear(), qStart, 1)),
        end: iso(new Date(today.getFullYear(), qStart + 3, 0))
      }
    },
    { key: 'year', label: '今年', range: { start: `${today.getFullYear()}-01-01`, end: `${today.getFullYear()}-12-31` } }
  ]

  const activePreset = presets.find((p) => p.range.start === range.start && p.range.end === range.end)?.key

  const dayDiff = (a: string, b: string): number =>
    Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000)

  const rangeDays = dayDiff(range.start, range.end) + 1
  const elapsed = Math.min(rangeDays, Math.max(1, dayDiff(range.start, iso(today)) + 1))
  const emptyDays = Math.max(0, elapsed - stats.daysWithTasks)
  const avgPerDay = stats.daysWithTasks > 0 ? (stats.totalTasks / stats.daysWithTasks).toFixed(1) : '0'

  let streak = 0
  let bestStreak = 0
  for (const d of stats.daily) {
    if (d.taskCount > 0) {
      streak += 1
      if (streak > bestStreak) bestStreak = streak
    } else {
      streak = 0
    }
  }

  const maxTag = Math.max(1, ...stats.tagCounts.map((t) => t.count))

  return (
    <div className="stats-view">
      <header className="workhead">
        <div className="wh-left">
          <span className="wh-title wh-title--hero">统计</span>
          <span className="wh-sub">
            {range.start} – {range.end} · 共 {rangeDays} 天 · 有记录 {stats.daysWithTasks} 天
          </span>
        </div>
        <div className="wh-right">
          <button className="btn btn--sm" onClick={thisMonth}>
            回到本月
          </button>
        </div>
      </header>

      <div className="with-side">
        <aside className="page-side">
          <div className="ps-head">
            <span>时间范围</span>
          </div>
          <div className="seg st-seg">
            {presets.map((p) => (
              <button
                key={p.key}
                className={'seg-btn' + (activePreset === p.key ? ' on' : '')}
                onClick={() => setRange(p.range)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="st-custom">
            <DatePicker
              value={range.start}
              onChange={(v) => setRange((r) => ({ ...r, start: v <= r.end ? v : r.start }))}
              title="区间起始日期"
            />
            <span className="mt-range-sep">~</span>
            <DatePicker
              value={range.end}
              onChange={(v) => setRange((r) => ({ ...r, end: v >= r.start ? v : r.end }))}
              title="区间结束日期"
            />
          </div>

          <div className="ps-head">
            <span>区间概览</span>
          </div>
          <div className="ps-kv">
            <span>记录天数</span>
            <b>
              {stats.daysWithTasks} / {stats.totalDays}
            </b>
          </div>
          <div className="ps-kv">
            <span>任务总数</span>
            <b>{stats.totalTasks}</b>
          </div>
          <div className="ps-kv">
            <span>已完成</span>
            <b>{stats.doneTasks}</b>
          </div>
          <div className="ps-kv">
            <span>完成率</span>
            <b>{rate}%</b>
          </div>
          <div className="ps-kv">
            <span>最长连续记录</span>
            <b>{bestStreak} 天</b>
          </div>
        </aside>

        <div className="page-main">
          <div className="workscroll">
            <div className="stat-cards">
              <div className="stat-card">
                <span className="stat-icon">
                  <CheckCircle2 size={17} />
                </span>
                <div className="stat-num">
                  {stats.doneTasks}
                  <em>个</em>
                </div>
                <div className="stat-label">完成任务</div>
                <div className="stat-foot">{stats.pendingTasks} 个未完成</div>
              </div>
              <div className="stat-card">
                <span className="stat-icon">
                  <CalendarCheck2 size={17} />
                </span>
                <div className="stat-num">
                  {stats.daysWithTasks}
                  <em>天</em>
                </div>
                <div className="stat-label">有记录天数</div>
                <div className="stat-foot">
                  区间 {rangeDays} 天 · 空 {emptyDays} 天
                </div>
              </div>
              <div className="stat-card">
                <span className="stat-icon">
                  <ListTodo size={17} />
                </span>
                <div className="stat-num">
                  {stats.totalTasks}
                  <em>个</em>
                </div>
                <div className="stat-label">任务总数</div>
                <div className="stat-foot">平均每天 {avgPerDay} 个</div>
              </div>
              <div className="stat-card">
                <span className="stat-icon">
                  <TrendingUp size={17} />
                </span>
                <div className="stat-num">
                  {rate}
                  <em>%</em>
                </div>
                <div className="stat-label">完成率</div>
                <div className="stat-foot">
                  {stats.doneTasks} / {stats.totalTasks}
                </div>
              </div>
            </div>

            <div className="stat-duo stat-duo--top">
              <div className="stat-section">
                <h3>
                  <span className="st-h3-ic">
                    <BarChart3 size={14} />
                  </span>
                  每日任务量
                  <span className="st-legend">
                    <i className="lg-done" />
                    完成
                    <i className="lg-todo" />
                    未完成
                  </span>
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
                <h3>
                  <span className="st-h3-ic">
                    <CheckCircle2 size={14} />
                  </span>
                  完成率
                </h3>
                <div className="ring-wrap">
                  <div className="ring" style={{ '--p': rate } as CSSProperties}>
                    <div className="ring-inner">
                      <strong>{rate}%</strong>
                      <span>区间</span>
                    </div>
                  </div>
                  <div className="ring-legend">
                    <div className="lg">
                      <i className="ok" />
                      已完成
                      <b>{stats.doneTasks}</b>
                    </div>
                    <div className="lg">
                      <i className="warn" />
                      未完成
                      <b>{stats.pendingTasks}</b>
                    </div>
                    <div className="lg">
                      <i className="dim" />
                      有记录
                      <b>
                        {stats.daysWithTasks} / {stats.totalDays}
                      </b>
                    </div>
                  </div>
                </div>
                <div className="st-kv">
                  <span>最长连续记录</span>
                  <b>{bestStreak} 天</b>
                </div>
                <div className="st-kv">
                  <span>平均每天任务</span>
                  <b>{avgPerDay} 个</b>
                </div>
              </div>
            </div>

            <div className="stat-duo">
              <div className="stat-section">
                <h3>
                  <span className="st-h3-ic">
                    <Tags size={14} />
                  </span>
                  标签分布
                  <span className="st-h3-side">按任务数</span>
                </h3>
                {stats.tagCounts.length === 0 ? (
                  <div className="muted">暂无标签</div>
                ) : (
                  <div className="st-tbars">
                    {stats.tagCounts.map((t) => (
                      <div className="st-tbar" key={t.tagId}>
                        <span className="st-tbar-name">{t.name}</span>
                        <span className="st-tbar-track">
                          <i style={{ width: `${(t.count / maxTag) * 100}%`, background: t.color }} />
                        </span>
                        <span className="st-tbar-n">{t.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="stat-section">
                <h3>
                  <span className="st-h3-ic">
                    <CalendarCheck2 size={14} />
                  </span>
                  记录热力
                  <span className="st-h3-side">近 {rangeDays} 天</span>
                </h3>
                <div className="heat">
                  {stats.daily.map((d) => {
                    const lv = d.taskCount === 0 ? 0 : Math.min(4, d.taskCount)
                    return (
                      <span
                        key={d.date}
                        className={'hcell' + (lv === 0 ? ' empty' : '')}
                        style={{ '--l': lv } as CSSProperties}
                        title={`${d.date}：${d.taskCount} 个任务，完成 ${d.doneCount}`}
                      />
                    )
                  })}
                </div>
                <div className="heat-legend">
                  <span>少</span>
                  <i style={{ '--l': 1 } as CSSProperties} />
                  <i style={{ '--l': 2 } as CSSProperties} />
                  <i style={{ '--l': 3 } as CSSProperties} />
                  <i style={{ '--l': 4 } as CSSProperties} />
                  <span>多</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
