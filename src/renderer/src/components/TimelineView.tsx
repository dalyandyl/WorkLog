import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, CheckSquare, Search, Square, X } from 'lucide-react'
import type { Task } from '../types'
import RichView from './RichView'
import { toDateStr, weekdayOf } from '../utils/date'

/** 时间线覆盖范围：默认近 90 天，数据攒多了还能收窄 / 放开到全部 */
type Scope = '7d' | '30d' | '90d' | 'year' | 'all'

const SCOPES: { key: Scope; label: string }[] = [
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
  { key: '90d', label: '近 90 天' },
  { key: 'year', label: '今年' },
  { key: 'all', label: '全部' }
]

/**
 * 时间线上的一个条目：**一个任务一条**。
 * 区间发布的任务（同一个 task.id 写进好几天）只在最早那天出现一次，
 * dates 里保留它覆盖的全部日期，用来标注「9/10–9/20 · 11 天」。
 */
interface Entry {
  key: string
  task: Task
  /** 这个任务出现过的所有日志日期（升序） */
  dates: string[]
  /** 时间线上的落点：最早那天 */
  date: string
}

function shiftDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + delta)
  return toDateStr(d)
}

/** 范围起点（含当天）：近 N 天 = 今天往前推 N-1 天 */
function scopeStart(scope: Scope, today: string): string {
  if (scope === '7d') return shiftDays(today, -6)
  if (scope === '30d') return shiftDays(today, -29)
  if (scope === '90d') return shiftDays(today, -89)
  if (scope === 'year') return `${today.slice(0, 4)}-01-01`
  return '0000-01-01'
}

/** '2026-10-23' -> '10-23' */
function shortDate(date: string): string {
  return date.slice(5)
}

/** ISO 时间 -> 本地「2026-10-23 14:05」；解析不出来就退回原串截断 */
function clock(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.replace('T', ' ').slice(0, 16)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 把「日期 -> 当天任务」摊平成条目：按任务 id 合并多天副本，落点取最早那天 */
function buildEntries(byDate: Record<string, Task[]>): Entry[] {
  const byId = new Map<string, Entry>()
  const dates = Object.keys(byDate).sort()
  for (const date of dates) {
    const dayTasks = [...(byDate[date] ?? [])].sort((a, b) => a.order - b.order)
    for (const task of dayTasks) {
      const cur = byId.get(task.id)
      if (cur) {
        if (cur.dates[cur.dates.length - 1] !== date) cur.dates.push(date)
        continue
      }
      byId.set(task.id, { key: task.id, task, dates: [date], date })
    }
  }
  return [...byId.values()].sort((a, b) => {
    // 日期倒序；同一天按当天顺序（order）
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    if (a.task.order !== b.task.order) return a.task.order - b.task.order
    return a.task.publishedAt < b.task.publishedAt ? -1 : 1
  })
}

/**
 * 任务时间线：左侧按日志日期倒排的任务列表，右侧按「日期 + 分割线」分段的任务详情。
 * 点击左侧条目跳转到对应内容；滚动右侧时，占据内容区最多、最接近居中的那一段
 * 会在左侧自动被选中（这就是「动态匹配」的判定：覆盖面积 0.7 + 居中程度 0.3，
 * 再加一点迟滞，避免两段交界处来回跳）。
 */
export default function TimelineView() {
  const [scope, setScope] = useState<Scope>('90d')
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState('')

  const today = useMemo(() => toDateStr(new Date()), [])
  const feedRef = useRef<HTMLDivElement | null>(null)
  const blockRefs = useRef<Record<string, HTMLElement | null>>({})
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const activeRef = useRef('')
  /** 点左侧跳转后短暂锁住联动，避免平滑滚动途中左侧一路闪过去 */
  const lockUntilRef = useRef(0)
  /** 跳转后的停靠点：停在这里就一直选中它，直到用户自己滚动 */
  const pinRef = useRef<{ key: string; top: number } | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const dates = await window.api.listTaskDates()
        const byDate = dates.length > 0 ? await window.api.readTasksMany(dates) : {}
        if (alive) setEntries(buildEntries(byDate))
      } catch {
        if (alive) setEntries([])
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const start = scopeStart(scope, today)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const qd = q.replace(/\D/g, '')
    // 「10月23」「10/23」「2026.10」统一成 10-23 这种写法再和日期串比
    const qt = q
      .replace(/[年月.\/]/g, '-')
      .replace(/[日号]/g, '')
      .replace(/-+/g, '-')
    const hasDigit = /\d/.test(qt)
    return entries.filter((e) => {
      if (!e.dates.some((d) => d >= start)) return false
      if (q === '') return true
      if (e.task.title.toLowerCase().includes(q)) return true
      if (!hasDigit) return false
      return e.dates.some(
        (d) => d.includes(qt) || (qd.length >= 2 && d.replace(/\D/g, '').includes(qd))
      )
    })
  }, [entries, start, query])

  // 筛选条件变了（范围 / 搜索）：回到顶部并选中第一条
  const shownKey = useMemo(() => shown.map((e) => e.key).join('|'), [shown])
  useEffect(() => {
    pinRef.current = null
    lockUntilRef.current = 0
    const first = shown[0]
    activeRef.current = first ? first.key : ''
    setActive(first ? first.key : '')
    if (feedRef.current) feedRef.current.scrollTop = 0
  }, [shownKey])

  // 滚动联动：挑「覆盖内容区最多 + 最接近居中」的那一段
  useEffect(() => {
    const feed = feedRef.current
    if (!feed || shown.length === 0) return
    let frame = 0

    const sync = (): void => {
      frame = 0
      if (Date.now() < lockUntilRef.current) return
      const pin = pinRef.current
      if (pin && Math.abs(feed.scrollTop - pin.top) < 14) return

      // 滚到顶 / 底时没有「居中」可言，直接选首尾（否则最后一条永远选不中）
      const atTop = feed.scrollTop <= 2
      const atBottom = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 2
      if (atTop || atBottom) {
        const edge = (atTop ? shown[0] : shown[shown.length - 1]).key
        if (edge !== activeRef.current) {
          activeRef.current = edge
          setActive(edge)
        }
        return
      }

      const box = feed.getBoundingClientRect()
      if (box.height < 40) return
      const mid = box.top + box.height / 2
      const scores = new Map<string, number>()
      let best = ''
      let bestScore = 0

      for (const e of shown) {
        const el = blockRefs.current[e.key]
        if (!el) continue
        const r = el.getBoundingClientRect()
        // 块是按文档顺序排的：已经掉到视野下方 200px 之外就可以停了
        if (r.top > box.bottom + 200) break
        const visible = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top)
        if (visible < 20) continue
        const cover = visible / box.height
        const near = 1 - Math.min(1, Math.abs((r.top + r.bottom) / 2 - mid) / (box.height * 0.65))
        const score = cover * 0.7 + near * 0.3
        scores.set(e.key, score)
        if (score > bestScore) {
          bestScore = score
          best = e.key
        }
      }

      if (best === '') return
      const cur = activeRef.current
      if (best === cur) return
      const curScore = scores.get(cur) ?? 0
      // 当前这段已经完全离开视野（或不在列表里）就直接换；否则要明显更优才换
      if (curScore === 0 || bestScore > curScore + 0.06) {
        activeRef.current = best
        setActive(best)
      }
    }

    const onScroll = (): void => {
      if (frame !== 0) return
      frame = requestAnimationFrame(sync)
    }

    feed.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    onScroll()
    return () => {
      feed.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [shown])

  // 左侧选中项跟着滚进视野
  useEffect(() => {
    if (active === '') return
    itemRefs.current[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function jump(key: string): void {
    const feed = feedRef.current
    const el = blockRefs.current[key]
    if (!feed || !el) return
    const raw = el.getBoundingClientRect().top - feed.getBoundingClientRect().top + feed.scrollTop - 8
    const top = Math.max(0, Math.min(raw, feed.scrollHeight - feed.clientHeight))
    activeRef.current = key
    setActive(key)
    pinRef.current = { key, top }
    lockUntilRef.current = Date.now() + 800
    feed.scrollTo({ top, behavior: 'smooth' })
  }

  const scopeLabel = SCOPES.find((s) => s.key === scope)?.label ?? ''
  const newest = shown.length > 0 ? shown[0].date : ''
  const oldest = shown.length > 0 ? shown[shown.length - 1].date : ''
  const rangeText =
    newest === '' ? '暂无记录' : newest === oldest ? newest : `${oldest} ～ ${newest}`

  const listEmptyText =
    query.trim() !== ''
      ? '没有匹配的任务'
      : entries.length === 0
        ? '还没有任务记录'
        : '这段时间没有任务'

  return (
    <div className="timeline-view">
      <header className="workhead">
        <div className="wh-left">
          <span className="wh-title wh-title--hero">任务时间线</span>
          <span className="wh-sub">
            {loading
              ? '正在读取…'
              : shown.length > 0
                ? `${scopeLabel} · ${rangeText} · ${shown.length} 条任务`
                : `${scopeLabel} · 暂无记录`}
          </span>
        </div>
        <div className="wh-right">
          <div className="seg tlv-seg">
            {SCOPES.map((s) => (
              <button
                key={s.key}
                className={'seg-btn' + (scope === s.key ? ' on' : '')}
                onClick={() => setScope(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="with-side">
        <aside className="page-side tlv-side">
          <div className="tlv-search">
            <Search size={13} />
            <input
              className="tlv-search-in"
              value={query}
              placeholder="搜日期或任务标题"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query !== '' && (
              <button className="tlv-search-x" title="清除搜索" onClick={() => setQuery('')}>
                <X size={12} />
              </button>
            )}
          </div>

          <div className="ps-head">
            <span>时间线</span>
            <span className="ps-count">{shown.length}</span>
          </div>

          {shown.length === 0 ? (
            <div className="ps-hint">
              <CalendarClock size={13} />
              {listEmptyText}
            </div>
          ) : (
            <div className="tlv-list">
              {shown.map((e, i) => {
                const prev = shown[i - 1]
                const month = e.date.slice(0, 7)
                const newMonth = !prev || prev.date.slice(0, 7) !== month
                const sameDay = prev !== undefined && prev.date === e.date
                return (
                  <div key={e.key} className="tlv-row">
                    {newMonth && (
                      <div className="tlv-month">
                        {month.slice(0, 4)} 年 {Number(month.slice(5, 7))} 月
                      </div>
                    )}
                    <button
                      className={
                        'tlv-item' +
                        (sameDay ? ' tlv-item--cont' : '') +
                        (active === e.key ? ' on' : '')
                      }
                      aria-current={active === e.key ? 'true' : undefined}
                      title={e.task.title}
                      ref={(el) => {
                        itemRefs.current[e.key] = el
                      }}
                      onClick={() => jump(e.key)}
                    >
                      <span className="tlv-dot" aria-hidden="true" />
                      <span className="tlv-item-date">
                        {shortDate(e.date)}
                        <b>{weekdayOf(e.date)}</b>
                      </span>
                      <span className="tlv-item-title">{e.task.title.trim() || '（无标题）'}</span>
                      {e.task.done && (
                        <span className="tlv-item-done" title="已完成">
                          ✓
                        </span>
                      )}
                      {e.dates.length > 1 && (
                        <span className="tlv-item-span" title="区间任务">
                          {shortDate(e.dates[0])}–{shortDate(e.dates[e.dates.length - 1])}
                        </span>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <div className="ps-hint">滚动右侧内容会自动定位左侧；点左侧条目可直接跳转</div>
        </aside>

        <div className="page-main">
          <div className="workscroll tlv-feed" ref={feedRef}>
            {loading ? (
              <div className="empty-state">正在读取任务…</div>
            ) : shown.length === 0 ? (
              <div className="empty-state">
                <CalendarClock size={26} />
                <div>
                  {query.trim() !== ''
                    ? `没有匹配「${query.trim()}」的任务`
                    : entries.length === 0
                      ? '还没有任何任务记录'
                      : `${scopeLabel}内没有任务`}
                </div>
                {query.trim() !== '' ? (
                  <div>换个日期（如 10-23、2026-10）或标题关键词试试</div>
                ) : entries.length === 0 ? (
                  <div>在日报页或任务发布页新建任务后，这里会按日期倒序列出</div>
                ) : (
                  <button className="btn btn--sm" onClick={() => setScope('all')}>
                    查看全部历史
                  </button>
                )}
              </div>
            ) : (
              shown.map((e, i) => {
                const prev = shown[i - 1]
                const sameDay = prev !== undefined && prev.date === e.date
                return (
                  <section
                    key={e.key}
                    className={
                      'tlv-block' +
                      (active === e.key ? ' on' : '') +
                      (sameDay ? ' same-day' : '')
                    }
                    ref={(el) => {
                      blockRefs.current[e.key] = el
                    }}
                  >
                    {sameDay ? (
                      /* 同一天的后续任务：不再重复日期，只留分割线（状态/区间胶囊照旧） */
                      <div className="tlv-when tlv-when--cont">
                        <span className="tlv-when-line" aria-hidden="true" />
                        {e.dates.length > 1 && (
                          <span className="pill pill--accent">
                            {shortDate(e.dates[0])} ～ {shortDate(e.dates[e.dates.length - 1])} ·{' '}
                            {e.dates.length} 天
                          </span>
                        )}
                        <span className={'pill' + (e.task.done ? ' pill--ok' : '')}>
                          <i />
                          {e.task.done ? '已完成' : '进行中'}
                        </span>
                      </div>
                    ) : (
                      <div className="tlv-when">
                        <span className="tlv-when-day">
                          {e.date}
                          <b>{weekdayOf(e.date)}</b>
                        </span>
                        <span className="tlv-when-line" aria-hidden="true" />
                        {e.dates.length > 1 && (
                          <span className="pill pill--accent">
                            {shortDate(e.dates[0])} ～ {shortDate(e.dates[e.dates.length - 1])} ·{' '}
                            {e.dates.length} 天
                          </span>
                        )}
                        <span className={'pill' + (e.task.done ? ' pill--ok' : '')}>
                          <i />
                          {e.task.done ? '已完成' : '进行中'}
                        </span>
                      </div>
                    )}

                    <div className="tlv-card">
                      <h3 className="tlv-title">{e.task.title.trim() || '（无标题）'}</h3>
                      <div className="tlv-meta">
                        <span>派发 {clock(e.task.publishedAt)}</span>
                        <span className="tlv-meta-sep" aria-hidden="true">
                          ·
                        </span>
                        <span className={e.task.completedAt ? '' : 'muted'}>
                          {e.task.completedAt ? `完成 ${clock(e.task.completedAt)}` : '完成 —'}
                        </span>
                      </div>

                      {e.task.body.trim() !== '' ? (
                        <div className="tlv-body">
                          <RichView content={e.task.body} />
                        </div>
                      ) : (
                        <div className="tlv-body tlv-body--empty">（无正文）</div>
                      )}

                      {e.task.subtasks.length > 0 && (
                        <ul className="tlv-subs">
                          {e.task.subtasks.map((s) => (
                            <li key={s.id} className={s.done ? 'done' : ''}>
                              {s.done ? <CheckSquare size={13} /> : <Square size={13} />}
                              <span>{s.title}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {e.task.note.trim() !== '' && (
                        <div className="tlv-note">
                          <span>备注</span>
                          <p>{e.task.note}</p>
                        </div>
                      )}
                    </div>
                  </section>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
