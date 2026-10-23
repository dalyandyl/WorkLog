import { useEffect, useMemo, useState } from 'react'
import { BarChart3, CalendarDays, CalendarRange, Check, Download, Eye, FileText, FolderOpen } from 'lucide-react'
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
import DropdownSelect from './DropdownSelect'
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

const PART_OPTIONS: { value: ReportPart; label: string }[] = [
  { value: 'summary', label: '汇总' },
  { value: 'detail', label: '明细' },
  { value: 'all', label: '汇总+明细' }
]

const TYPE_TILES: {
  gran: ReportGranularity
  name: string
  hint: string
  icon: typeof FileText
}[] = [
  { gran: 'week', name: '周报', hint: '按周汇总', icon: CalendarRange },
  { gran: 'month', name: '月报', hint: '按月汇总', icon: CalendarDays },
  { gran: 'day', name: '日报', hint: '单日', icon: FileText },
  { gran: 'year', name: '年报', hint: '按年汇总', icon: BarChart3 }
]

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

function addMonths(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setMonth(d.getMonth() + n)
  return toDateStr(d)
}

const PART_LABEL: Record<ReportPart, string> = {
  summary: '汇总',
  detail: '明细',
  all: '汇总+明细'
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

  // ---- 新版三栏布局用到的本地状态 ----
  const [part, setPart] = useState<ReportPart>('all')
  const [format, setFormat] = useState<'md' | 'word' | 'both'>('md')
  const [fileName, setFileName] = useState('')
  const [previewKind, setPreviewKind] = useState<'md' | 'word'>('word')

  const nameOf = (f: 'md' | 'word'): string =>
    (fileName.trim() || `日志报表-${rangeLabel}`).replace(/\.(md|docx?)$/i, '') + (f === 'md' ? '.md' : '.docx')

  async function copyMd(): Promise<void> {
    await navigator.clipboard.writeText(fullMarkdown)
    onStatus('已复制 Markdown')
  }

  async function generate(): Promise<void> {
    if (format === 'md' || format === 'both') await exportMd(part)
    if (format === 'word' || format === 'both') await exportWord(part)
  }

  const tocSections: { id: 'summary' | 'detail'; label: string }[] = [
    { id: 'summary', label: '汇总统计' },
    { id: 'detail', label: '任务明细' }
  ]

  function togglePart(id: 'summary' | 'detail'): void {
    let s = part === 'all' || part === 'summary'
    let d = part === 'all' || part === 'detail'
    if (id === 'summary') s = !s
    else d = !d
    // 两项都取消时回落到「仅汇总」，避免导出空文件
    setPart(s && d ? 'all' : s ? 'summary' : d ? 'detail' : 'summary')
  }

  const quickRanges = useMemo(() => {
    const mk = (gran: ReportGranularity, at: string, tag: string) => {
      const ds = expandReportDates(gran, at)
      const label = reportRangeLabel(gran, at, ds)
      // 侧栏宽度有限：周显示 MM-DD ~ MM-DD，其它显示 rangeLabel
      const short =
        gran === 'week' && ds.length > 1
          ? `${ds[0].slice(5)} ~ ${ds[ds.length - 1].slice(5)}`
          : label
      return { gran, anchor: at, tag, label: short, on: label === rangeLabel && gran === granularity }
    }
    return [
      mk('week', addDays(anchor, -7), '周报'),
      mk('month', addMonths(anchor, -1), '月报'),
      mk('week', addDays(anchor, -14), '周报')
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, anchor, rangeLabel])

  return (
    <div className="report-view rp">
      <header className="workhead">
        <div className="wh-left">
          <span className="wh-title wh-title--hero">报表</span>
          <span className="wh-sub">Markdown 与 Word 双格式导出</span>
        </div>
        <div className="wh-right">
          <button className="btn btn--sm" onClick={() => showPreview('md')}>
            <Eye size={15} />
            全屏预览
          </button>
          <button className="btn btn--primary" onClick={() => void generate()}>
            <Download size={15} />
            生成并导出
          </button>
        </div>
      </header>

      <div className="rp-body">
        {/* ① 左：快捷范围 + 导出说明 */}
        <aside className="rp-side">
          <div className="ps-head">
            <span>最近生成</span>
          </div>
          <div className="ps-list">
            {quickRanges.map((q) => (
              <button
                key={q.label}
                className={'ps-item' + (q.on ? ' on' : '')}
                onClick={() => {
                  setGranularity(q.gran)
                  setAnchor(q.anchor)
                }}
              >
                <span className="ps-item-name">{q.label}</span>
                <span className="pill">{q.tag}</span>
              </button>
            ))}
          </div>

          <div className="ps-head">
            <span>导出位置</span>
          </div>
          <div className="rp-path">
            <FolderOpen size={14} />
            <span>导出时选择保存位置</span>
          </div>
          <div className="ps-hint ps-hint--warn rp-tip">
            Word 导出会保留标题层级与表格；图片按原图嵌入，不压缩。
          </div>
        </aside>

        {/* ② 中：分类 → 范围 → 内容 → 格式 */}
        <div className="rp-form">
          <section className="rp-step">
            <h4>
              <span className="rp-step-n">1</span>报表类型
            </h4>
            <div className="rp-types">
              {TYPE_TILES.map((t) => (
                <button
                  key={t.gran}
                  className={'rp-type' + (granularity === t.gran ? ' on' : '')}
                  onClick={() => setGranularity(t.gran)}
                >
                  <span className="rp-type-ic">
                    <t.icon size={15} />
                  </span>
                  <span className="rp-type-name">{t.name}</span>
                  <span className="rp-type-meta">{granularity === t.gran ? rangeLabel : t.hint}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="rp-step">
            <h4>
              <span className="rp-step-n">2</span>范围
            </h4>
            <div className="rp-range">
              <DatePicker value={anchor} onChange={setAnchor} title={anchorTitle()} />
              <span className="rp-range-pill">{rangeLabel}</span>
            </div>
            <div className="rp-range-sub">
              {dates.length > 0 ? `${dates[0]} → ${dates[dates.length - 1]} · 共 ${dates.length} 天` : '无可用日期'}
            </div>
          </section>

          <section className="rp-step">
            <h4>
              <span className="rp-step-n">3</span>包含内容
            </h4>
            <div className="rp-checks">
              {tocSections.map((s) => (
                <label key={s.id} className="rp-check">
                  <span className={'cbox' + (part === 'all' || part === s.id ? ' on' : '')}>
                    <Check size={11} />
                  </span>
                  <input
                    type="checkbox"
                    checked={part === 'all' || part === s.id}
                    onChange={() => togglePart(s.id)}
                  />
                  <span>{s.label}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="rp-step">
            <h4>
              <span className="rp-step-n">4</span>导出格式
            </h4>
            <div className="seg rp-seg">
              {(
                [
                  ['md', 'Markdown'],
                  ['word', 'Word (.docx)'],
                  ['both', '两者']
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  className={'seg-btn' + (format === k ? ' on' : '')}
                  onClick={() => setFormat(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="rp-filename">
              <span>文件名</span>
              <input
                className="input"
                value={fileName}
                placeholder={`日志报表-${rangeLabel}`}
                onChange={(e) => setFileName(e.target.value)}
              />
            </label>
            <div className="rp-out">{nameOf(format === 'word' ? 'word' : 'md')}</div>
          </section>
        </div>

        {/* ③ 右：预览 */}
        <div className="rp-preview">
          <div className="rp-preview-head">
            <span className="rp-preview-title">
              <FileText size={15} />
              导出预览
            </span>
            <div className="seg rp-seg rp-seg--sm">
              <button className={'seg-btn' + (previewKind === 'word' ? ' on' : '')} onClick={() => setPreviewKind('word')}>
                Word 版式
              </button>
              <button className={'seg-btn' + (previewKind === 'md' ? ' on' : '')} onClick={() => setPreviewKind('md')}>
                Markdown
              </button>
            </div>
            <div className="rp-preview-acts">
              <button className="btn btn--sm btn--ghost" onClick={() => void copyMd()}>
                复制 Markdown
              </button>
              <button className="btn btn--sm btn--ghost" onClick={() => setAnchor(toDateStr(new Date()))}>
                刷新
              </button>
            </div>
          </div>
          <div className="rp-paper">
            {stats ? (
              previewKind === 'md' ? (
                <pre className="rp-md">{partMarkdown(part === 'summary' ? 'summary' : 'all')}</pre>
              ) : fullMarkdown ? (
                <RichView content={partMarkdown(part === 'summary' ? 'summary' : 'all')} />
              ) : (
                <div className="task-empty">暂无数据</div>
              )
            ) : (
              <div className="loading">加载中…</div>
            )}
          </div>
        </div>
      </div>

      <Modal open={preview !== null} title="导出预览" width={860} onClose={() => setPreview(null)}>
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