import { useEffect, useRef, useState } from 'react'
import type { SearchHit } from '../types'

interface SearchBoxProps {
  onPick: (date: string, taskId: string) => void
}

export default function SearchBox({ onPick }: SearchBoxProps) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    if (!q.trim()) {
      setHits([])
      setOpen(false)
      return
    }
    timer.current = window.setTimeout(async () => {
      const r = await window.api.searchTasks(q)
      setHits(r)
      setOpen(true)
    }, 250)
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [q])

  function pick(h: SearchHit): void {
    setOpen(false)
    setQ('')
    onPick(h.date, h.taskId)
  }

  return (
    <div className="search-wrap" ref={rootRef}>
      <input
        className="search-input"
        placeholder="搜索标题/正文/标签…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => {
          if (hits.length > 0) setOpen(true)
        }}
      />
      {open && (
        <div className="search-results">
          {hits.length === 0 ? (
            <div className="search-empty">无结果</div>
          ) : (
            hits.map((h) => (
              <button key={h.taskId} className="search-hit" onClick={() => pick(h)}>
                <span className="search-hit-date">{h.date}</span>
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
