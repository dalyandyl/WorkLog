import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { SearchHit } from '../types'

interface SearchBoxProps {
  /** 点中**任务**命中项 */
  onPick: (date: string, taskId: string) => void
  /** 点中**日志**命中项 */
  onPickJournal?: (date: string) => void
}

export default function SearchBox({ onPick, onPickJournal }: SearchBoxProps) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  /** 键盘高亮项下标（-1 = 无） */
  const [active, setActive] = useState(-1)
  const timer = useRef<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useRef(`wl-search-${Math.random().toString(36).slice(2, 9)}`).current
  /** 请求序号：防抖后发出的请求可能乱序返回，只接受最后一次的结果 */
  const reqSeq = useRef(0)

  useEffect(() => {
    function onDoc(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    // 输入变化即作废在途请求，避免旧关键词的结果覆盖新结果
    reqSeq.current++
    if (!q.trim()) {
      setHits([])
      setOpen(false)
      setActive(-1)
      return
    }
    timer.current = window.setTimeout(async () => {
      const seq = ++reqSeq.current
      const r = await window.api.searchAll(q)
      if (seq !== reqSeq.current) return
      setHits(r)
      setOpen(true)
      setActive(-1)
    }, 250)
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [q])

  function pick(h: SearchHit): void {
    setOpen(false)
    setQ('')
    setActive(-1)
    if (h.kind === 'journal') onPickJournal?.(h.date)
    else onPick(h.date, h.taskId)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (hits.length === 0) return
      e.preventDefault()
      if (!open) {
        setOpen(true)
        setActive(0)
        return
      }
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1
        if (next < 0) return 0
        return Math.min(next, hits.length - 1)
      })
      return
    }
    if (e.key === 'Enter' && open && active >= 0 && active < hits.length) {
      e.preventDefault()
      pick(hits[active])
    }
  }

  return (
    <div className="search-wrap" ref={rootRef}>
      <input
        className="search-input"
        placeholder="搜索任务与日志..."
        value={q}
        role="combobox"
        aria-label="搜索任务与日志"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (hits.length > 0) setOpen(true)
        }}
      />
      {open && (
        <div className="search-results" role="listbox" id={listId} aria-label="搜索结果">
          {hits.length === 0 ? (
            <div className="search-empty">无结果</div>
          ) : (
            hits.map((h, i) => (
              <button
                // 区间共享任务会让同一个 taskId 命中多天，所以 key 必须带上日期；
                // 日志用 entryId（同一天也可能有多条）
                key={`${h.date}-${h.entryId ?? h.taskId}-${i}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'search-hit active' : 'search-hit'}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(h)}
              >
                <span className="search-hit-top">
                  <span className="search-hit-date">{h.date}</span>
                  <span
                    className={h.kind === 'journal' ? 'search-hit-kind journal' : 'search-hit-kind'}
                  >
                    {h.kind === 'journal' ? '日志' : '任务'}
                  </span>
                </span>
                <span className="search-hit-title">{h.title}</span>
                <span className="search-hit-snippet">{h.snippet}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
