import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toDateStr } from '../utils/date'
import { holidayInfoOf, isRestDay, loadHolidayYear, refreshHolidayYear } from '../utils/holidays'
import DatePicker from './DatePicker'

interface CalendarProps {
  selected: string
  markers: Set<string>
  onSelect: (date: string) => void
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

export default function Calendar({ selected, markers, onSelect }: CalendarProps) {
  const [selYear, selMonth] = selected.split('-').map(Number)
  const [view, setView] = useState({ year: selYear, month: selMonth - 1 })
  // 拉取到新年份数据后自增，触发重渲染刷新标红
  const [, setHolidayVersion] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')

  useEffect(() => {
    setView({ year: selYear, month: selMonth - 1 })
  }, [selected])

  // 当前显示年份变化时，按需拉取该年节假日数据
  useEffect(() => {
    let cancelled = false
    loadHolidayYear(view.year).then(() => {
      if (!cancelled) setHolidayVersion((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
  }, [view.year])

  const today = toDateStr(new Date())

  function shiftMonth(delta: number): void {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  function goToday(): void {
    // 直接重置视图到今天的年月（修复：日期未变时视图不切换的问题）
    const now = new Date()
    setView({ year: now.getFullYear(), month: now.getMonth() })
    onSelect(today)
  }

  async function refreshCalendar(): Promise<void> {
    setRefreshing(true)
    setRefreshMsg('')
    try {
      const data = await refreshHolidayYear(view.year)
      setHolidayVersion((v) => v + 1)
      const hasHoliday =
        data && (Object.keys(data.holiday).length > 0 || Object.keys(data.workday).length > 0)
      setRefreshMsg(
        hasHoliday ? '已更新' : `${view.year} 年节假日安排尚未公布，仅周末标红`
      )
    } finally {
      setRefreshing(false)
    }
  }

  const firstWeekday = (new Date(view.year, view.month, 1).getDay() + 6) % 7 // 周一=0
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${view.year}-${String(view.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }

  return (
    <div className="calendar">
      <div className="cal-head">
        <button className="cal-nav" onClick={() => shiftMonth(-1)} title="上个月">
          ‹
        </button>
        <DatePicker
          portal
          value={`${view.year}-${String(view.month + 1).padStart(2, '0')}-01`}
          onChange={onSelect}
          label={`${view.year} 年 ${view.month + 1} 月`}
          title="点击选择日期（年 / 月 / 日）"
        />
        <button className="cal-nav" onClick={() => shiftMonth(1)} title="下个月">
          ›
        </button>
      </div>
      <div className="cal-weekdays">
        {WEEKDAYS.map((w) => (
          <div key={w} className="cal-weekday">
            {w}
          </div>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((d, i) => {
          if (d === null) return <div key={`e${i}`} className="cal-cell empty" />
          const info = holidayInfoOf(d)
          const rest = isRestDay(d)
          const cls = [
            'cal-cell',
            d === selected ? 'selected' : '',
            d === today ? 'today' : '',
            markers.has(d) ? 'has-log' : '',
            rest ? 'rest' : '',
            info?.kind === 'adjusted-work' ? 'adjusted' : ''
          ]
            .filter(Boolean)
            .join(' ')
          const tip = info
            ? `${d}（${info.name}）`
            : rest
              ? `${d}（周末）`
              : d
          return (
            <button key={d} className={cls} onClick={() => onSelect(d)} title={tip}>
              {Number(d.slice(8, 10))}
              {info?.kind === 'holiday' && <span className="cal-dot" />}
              {info?.kind === 'adjusted-work' && <span className="cal-badge">班</span>}
            </button>
          )
        })}
      </div>
      <div className="cal-foot-btns">
        <button className="today-btn" onClick={goToday}>
          回到今天
        </button>
        <button className="today-btn cal-refresh-btn" onClick={refreshCalendar} title="联网重新拉取当前年份节假日">
          {refreshing ? '更新中…' : <><RefreshCw size={13} /> 更新日历</>}
        </button>
      </div>
      {refreshMsg && <div className="cal-refresh-msg">{refreshMsg}</div>}
    </div>
  )
}
