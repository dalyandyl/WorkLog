import { useEffect, useMemo, useState } from 'react'
import type { MonthStats, Tag, Task } from '../types'
import { toDateStr } from '../utils/date'
import { renderMarkdown } from '../utils/markdown'
import {
  buildReportMarkdown,
  expandReportDates,
  reportRangeLabel,
  type ReportGranularity,
  type ReportPart
} from '../utils/report'
import DatePicker from './DatePicker'
import RichView from './RichView'
import Modal from './Modal'

interface ReportViewProps {
  tags: Tag[]
  onStatus: (msg: string) => void
}

const GRAN_OPTIONS: { value: ReportGranularity; label: string }[] = [
  { value: 'day', label: '按日' },
  { value: 'week', label: '按周' },
  { value: 'month', label: '按月' },
  { value: 'year', label: '按年' }
]

const PART_LABEL: Record<ReportPart, string> = {
  summary: '汇总',
  detail: '明细',
  all: '全部'
}

export default function ReportView({ tags, onStatus }: ReportViewProps) {
  const [granularity, setGranularity] = useState<ReportGranularity>('month')
  const [anchor, setAnchor] = useState(() => toDateStr(new Date()))
  const [stats, setStats] = useState<MonthStats | null>(null)
  const [tasksByDate, setTasksByDate] = useState<Record<string, Task[]>>({})
  const [preview, setPreview] = useState<{ kind: 'md' | 'word'; content: string } | null>(null)
  const [mdPart, setMdPart] = useState<ReportPart>('all')
  const [wordPart, setWordPart] = useState<ReportPart>('all')

  useEffect(() => {
    const dates = expandReportDates(granularity, anchor)
    if (dates.length === 0) return
    let cancelled = false
    Promise.all([
      window.api.rangeStats(dates[0], dates[dates.length - 1]),
      window.api.readTasksMany(dates)
    ]).then(([s, tbd]) => {
      if (cancelled) return
      setStats(s)
      setTasksByDate(tbd)
    })
    return () => {
      cancelled = true
    }
  }, [granularity, anchor])

  const dates = useMemo(() => expandReportDates(granularity, anchor), [granularity, anchor])

  function partMarkdown(part: ReportPart): string {
    if (!stats) return ''
    return buildReportMarkdown(granularity, anchor, dates, stats, tasksByDate, tags, part)
  }

  const fullMarkdown = partMarkdown('all')
  const rangeLabel = reportRangeLabel(granularity, anchor, dates)

  function anchorTitle(): string {
    if (granularity === 'day') return '选择日期'
    if (granularity === 'week') return '选择日期（跳到所在周）'
    if (granularity === 'month') return '选择日期（取所在月）'
    return '选择日期（取所在年）'
  }

  function wordHtml(part: ReportPart): string {
    const body = renderMarkdown(partMarkdown(part))
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
      body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;line-height:1.7;color:#1f2329;margin:32px;font-size:14px;}
      h1{font-size:22px;border-bottom:2px solid #3b82f6;padding-bottom:8px;}
      h2{font-size:18px;margin-top:24px;}h3{font-size:15px;margin-top:16px;}
      code{background:#f3f4f6;border-radius:4px;padding:1px 6px;font-family:Consolas,monospace;}
      pre{background:#f6f8fa;padding:12px;border-radius:8px;overflow-x:auto;}pre code{background:transparent;padding:0;}
      img{max-width:100%;}blockquote{border-left:3px solid #d1d5db;margin:8px 0;padding:2px 14px;color:#6b7280;}
      </style></head><body>${body}</body></html>`
  }

  async function exportMd(part: ReportPart): Promise<void> {
    const md = partMarkdown(part)
    if (!md) return
    const r = await window.api.exportReportMd(md, `日志报表-${rangeLabel}-${PART_LABEL[part]}`)
    if (r.ok) onStatus('已导出 Markdown：' + r.path)
    else if (!r.canceled && r.error) onStatus('导出失败：' + r.error)
  }

  async function exportWord(part: ReportPart): Promise<void> {
    if (!stats) return
    const r = await window.api.exportReportWord(wordHtml(part), `日志报表-${rangeLabel}-${PART_LABEL[part]}`)
    if (r.ok) onStatus('已导出 Word：' + r.path)
    else if (!r.canceled && r.error) onStatus('导出失败：' + r.error)
  }

  function showPreview(kind: 'md' | 'word'): void {
    if (kind === 'md') setPreview({ kind, content: fullMarkdown })
    else setPreview({ kind, content: renderMarkdown(fullMarkdown) })
  }

  return (
    <div className="report-view">
      <div className="date-heading">
        <h2>日志报表</h2>
        <span className="weekday">汇总统计 + 任务明细，支持导出 Markdown / Word</span>
      </div>

      <div className="report-controls">
        <div className="publish-granularity">
          {GRAN_OPTIONS.map((g) => (
            <label key={g.value}>
              <input
                type="radio"
                name="reportgran"
                checked={granularity === g.value}
                onChange={() => setGranularity(g.value)}
              />
              {g.label}
            </label>
          ))}
        </div>
        <DatePicker value={anchor} onChange={setAnchor} title={anchorTitle()} />
        <span className="report-range-label">当前范围：{rangeLabel}</span>
        <div className="report-actions">
          <div className="report-export-group">
            <span className="report-export-label">MD</span>
            <button className="icon-btn" onClick={() => showPreview('md')} title="预览 Markdown">
              👁
            </button>
            <button className="ghost-btn" onClick={() => exportMd(mdPart)} disabled={!stats}>导出</button>
            <select
              className="gran-select"
              value={mdPart}
              onChange={(e) => setMdPart(e.target.value as ReportPart)}
              title="导出内容"
            >
              <option value="summary">汇总</option>
              <option value="detail">明细</option>
              <option value="all">全部</option>
            </select>
          </div>
          <div className="report-export-group">
            <span className="report-export-label">Word</span>
            <button className="icon-btn" onClick={() => showPreview('word')} title="预览 Word">
              👁
            </button>
            <button className="ghost-btn" onClick={() => exportWord(wordPart)} disabled={!stats}>导出</button>
            <select
              className="gran-select"
              value={wordPart}
              onChange={(e) => setWordPart(e.target.value as ReportPart)}
              title="导出内容"
            >
              <option value="summary">汇总</option>
              <option value="detail">明细</option>
              <option value="all">全部</option>
            </select>
          </div>
        </div>
      </div>

      <div className="report-preview">
        {stats ? (
          fullMarkdown ? (
            <RichView content={fullMarkdown} />
          ) : (
            <div className="task-empty">暂无数据</div>
          )
        ) : (
          <div className="loading">加载中…</div>
        )}
      </div>

      <Modal open={preview !== null} title="导出预览" width={760} onClose={() => setPreview(null)}>
        {preview && (
          <div className="report-preview-modal">
            {preview.kind === 'md' ? (
              <pre className="report-md-raw">{preview.content}</pre>
            ) : (
              <div
                className="report-word-preview"
                dangerouslySetInnerHTML={{ __html: preview.content }}
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
