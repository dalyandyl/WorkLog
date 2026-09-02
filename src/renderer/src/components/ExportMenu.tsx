import { useEffect, useRef, useState } from 'react'
import { toDateStr } from '../utils/date'

interface ExportMenuProps {
  date: string
  weekKey: string
  projectId: string
  onStatus: (msg: string) => void
}

export default function ExportMenu({ date, weekKey, projectId, onStatus }: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const [rangeMode, setRangeMode] = useState(false)
  const [start, setStart] = useState(toDateStr(new Date()))
  const [end, setEnd] = useState(toDateStr(new Date()))
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setRangeMode(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  async function doExport(
    opts:
      | { mode: 'day'; date: string }
      | { mode: 'week'; weekKey: string }
      | { mode: 'range'; start: string; end: string }
  ): Promise<void> {
    setOpen(false)
    setRangeMode(false)
    const r = await window.api.exportMarkdown({ ...opts, projectId })
    if (r.ok) onStatus('已导出：' + r.path)
    else if (r.canceled) onStatus('已取消导出')
    else onStatus('导出失败：' + (r.error || '未知错误'))
  }

  function pickRange(): void {
    setOpen(false)
    setRangeMode(true)
  }

  return (
    <div className="export-wrap" ref={rootRef}>
      <button className="export-btn" onClick={() => setOpen((v) => !v)}>
        导出 ▾
      </button>
      {open && (
        <div className="export-menu">
          <button className="export-item" onClick={() => doExport({ mode: 'day', date })}>
            导出本日
          </button>
          <button className="export-item" onClick={() => doExport({ mode: 'week', weekKey })}>
            导出本周
          </button>
          <button className="export-item" onClick={pickRange}>
            导出自定义范围…
          </button>
        </div>
      )}
      {rangeMode && (
        <div className="export-range">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <span>至</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          <button
            className="export-range-ok"
            onClick={() => doExport({ mode: 'range', start, end })}
          >
            导出
          </button>
          <button className="export-range-cancel" onClick={() => setRangeMode(false)}>
            取消
          </button>
        </div>
      )}
    </div>
  )
}
