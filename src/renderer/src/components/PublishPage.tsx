import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Info, Plus, Send, X } from 'lucide-react'
import type { PublishRecord, Subtask, Tag } from '../types'
import { enumerateDates, toDateStr, weekdayOf } from '../utils/date'
import DatePicker from './DatePicker'
import TagPicker from './TagPicker'

const RichBodyEditor = lazy(() => import('./RichBodyEditor'))

/** 一条待发布草稿：标题 / 正文 / 标签 / 子任务 都是这条自己的 */
interface Draft {
  id: string
  title: string
  body: string
  tags: string[]
  subtasks: Subtask[]
}

interface PublishPageProps {
  tags: Tag[]
  history: PublishRecord[]
  onStatus: (msg: string) => void
  onPublished: () => void
  onGoToTags: () => void
}

function newDraft(title = ''): Draft {
  return { id: crypto.randomUUID(), title, body: '', tags: [], subtasks: [] }
}

function newSub(title: string): Subtask {
  return { id: crypto.randomUUID(), title, done: false, tags: [] }
}

/** 去掉 HTML 标签后判断正文是否为空 */
function hasBody(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0
}

/**
 * 任务发布页：左「最近发布 + 提示」/ 中「草稿列表 + 单条编辑 + 日期区间」/ 右「发布预览」。
 * 每条草稿各自持有标题 / 正文 / 标签 / 子任务，只有发布日期整批共享。
 */
export default function PublishPage({
  tags,
  history,
  onStatus,
  onPublished,
  onGoToTags
}: PublishPageProps) {
  const today = toDateStr(new Date())
  const [drafts, setDrafts] = useState<Draft[]>(() => [newDraft()])
  const [activeId, setActiveId] = useState<string>('')
  const [rangeMode, setRangeMode] = useState(true)
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [subDraft, setSubDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [existing, setExisting] = useState<Record<string, number>>({})

  // activeId 失效时指到第一条
  useEffect(() => {
    if (!drafts.some((d) => d.id === activeId)) setActiveId(drafts[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts.length])

  const active = drafts.find((d) => d.id === activeId) ?? drafts[0]

  const dates = useMemo(() => {
    if (!rangeMode) return [start]
    if (!start || !end || end < start) return []
    return enumerateDates(start, end)
  }, [rangeMode, start, end])

  useEffect(() => {
    let cancelled = false
    if (dates.length === 0) {
      setExisting({})
      return
    }
    window.api.readTasksMany(dates).then((map) => {
      if (cancelled) return
      const next: Record<string, number> = {}
      for (const d of dates) next[d] = map[d]?.length ?? 0
      setExisting(next)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates.join(',')])

  const ready = drafts.filter((d) => d.title.trim())
  const overlapDays = dates.filter((d) => (existing[d] ?? 0) > 0)
  const totalCopies = dates.length * ready.length
  const canPublish = ready.length > 0 && dates.length > 0 && !busy

  function patchDraft(id: string, patch: Partial<Draft>): void {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  /** 回车 / 粘贴多行：每行生成一条草稿 */
  function addDrafts(text: string): void {
    const lines = text
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)
    if (lines.length === 0) return
    const next = lines.map((t) => newDraft(t))
    setDrafts((prev) => [...prev, ...next])
    setActiveId(next[0].id)
  }

  function removeDraft(id: string): void {
    setDrafts((prev) => {
      const next = prev.filter((d) => d.id !== id)
      return next.length === 0 ? [newDraft()] : next
    })
  }

  function addSub(): void {
    const t = subDraft.trim()
    if (!t || !active) return
    patchDraft(active.id, { subtasks: [...active.subtasks, newSub(t)] })
    setSubDraft('')
  }

  function reset(): void {
    const d = newDraft()
    setDrafts([d])
    setActiveId(d.id)
    setSubDraft('')
  }

  async function publish(): Promise<void> {
    if (ready.length === 0) {
      onStatus('请至少填写一条任务标题')
      return
    }
    if (dates.length === 0) {
      onStatus('发布区间无效，请检查起止日期')
      return
    }
    setBusy(true)
    try {
      for (const d of ready) {
        await window.api.publishTasks(dates, {
          title: d.title.trim(),
          tags: d.tags,
          body: d.body,
          subtasks: d.subtasks.map((s) => ({ ...s, id: crypto.randomUUID() }))
        })
      }
      onStatus(`已发布 ${ready.length} 条任务 · 共 ${totalCopies} 份副本`)
      onPublished()
      reset()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pub-body">
      {/* 左：最近发布 + 提示 */}
      <aside className="pub-side">
        <div className="ps-head">
          <span>最近发布</span>
        </div>
        <div className="ps-list">
          {history.slice(0, 6).map((rec) => (
            <div key={rec.id} className="ps-item ps-item--static">
              <span className="ps-item-name">{fmtRange(rec.dates)}</span>
              <span className="ps-item-meta">{rec.dates.length} 天</span>
            </div>
          ))}
          {history.length === 0 && <p className="ps-empty">还没有发布记录</p>}
        </div>
        <div className="hint">
          <Info size={13} />
          区间发布会<strong>在每一天各写一份任务副本</strong>，修改任意一天的内容都会同步到全部副本。
        </div>
      </aside>

      {/* 中：草稿列表 + 单条编辑 + 日期区间 */}
      <div className="pub-form">
        <section className="rp-step">
          <h4>
            <span className="rp-step-n">1</span>
            任务内容
            <span className="st-h3-side">{drafts.length} 条草稿 · 逐条编辑</span>
          </h4>

          <div className="pub-drafts">
            {drafts.map((d, i) => (
              <div
                key={d.id}
                className={'pub-draft' + (d.id === active?.id ? ' on' : '')}
                onClick={() => setActiveId(d.id)}
                role="button"
              >
                <span className="pub-draft-n">{i + 1}</span>
                <span className="pub-draft-t">{d.title.trim() || '未命名任务'}</span>
                <span className={'pub-draft-flag' + (hasBody(d.body) ? '' : ' is-empty')}>
                  {hasBody(d.body) ? '有正文' : '空正文'}
                </span>
                {d.tags.length > 0 && <span className="pub-draft-flag">{d.tags.length} 标签</span>}
                {d.subtasks.length > 0 && (
                  <span className="pub-draft-flag">{d.subtasks.length} 子任务</span>
                )}
                <button
                  className="icon-btn danger pub-draft-del"
                  title="删除该条"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeDraft(d.id)
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <div className="pub-draft-add">
              <input
                className="input"
                placeholder="输入标题后回车追加一条；粘贴多行可一次建多条"
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  const el = e.currentTarget
                  addDrafts(el.value)
                  el.value = ''
                }}
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text')
                  if (!text.includes('\n')) return
                  e.preventDefault()
                  addDrafts(text)
                  e.currentTarget.value = ''
                }}
              />
            </div>
          </div>

          {active && (
            <div className="pub-editor">
              <input
                className="input pub-editor-title"
                placeholder="任务标题"
                value={active.title}
                onChange={(e) => patchDraft(active.id, { title: e.target.value })}
              />
              <TagPicker
                selectedIds={active.tags}
                allTags={tags}
                onChange={(ids) => patchDraft(active.id, { tags: ids })}
                onGoToTags={onGoToTags}
              />
              <div className="pub-subs">
                {active.subtasks.map((s, i) => (
                  <div key={s.id} className="pub-sub">
                    <span className="pub-sub-n">{i + 1}</span>
                    <span className="pub-sub-t">{s.title}</span>
                    <button
                      className="icon-btn danger"
                      title="移除"
                      onClick={() =>
                        patchDraft(active.id, {
                          subtasks: active.subtasks.filter((x) => x.id !== s.id)
                        })
                      }
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <div className="pub-sub-add">
                  <input
                    className="input"
                    placeholder="添加子任务，回车即可"
                    value={subDraft}
                    onChange={(e) => setSubDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addSub()
                      }
                    }}
                  />
                  <button className="btn btn--sm btn--ghost" onClick={addSub} type="button">
                    <Plus size={13} />
                    添加
                  </button>
                </div>
              </div>
              <div className="pub-bodyedit">
                <Suspense fallback={<div className="editor-loading">编辑器加载中…</div>}>
                  <RichBodyEditor
                    key={active.id}
                    value={active.body}
                    onChange={(v) => patchDraft(active.id, { body: v })}
                    attachFolder="publish"
                    onStatus={onStatus}
                  />
                </Suspense>
              </div>
            </div>
          )}
        </section>

        <section className="rp-step">
          <h4>
            <span className="rp-step-n">2</span>
            发布日期区间
            <span className="st-h3-side">整批共享</span>
          </h4>
          <div className="rp-range">
            <button
              className={'seg-btn' + (rangeMode ? ' on' : '')}
              onClick={() => setRangeMode(true)}
              type="button"
            >
              区间
            </button>
            <button
              className={'seg-btn' + (!rangeMode ? ' on' : '')}
              onClick={() => setRangeMode(false)}
              type="button"
            >
              单日
            </button>
            <DatePicker value={start} onChange={setStart} title="开始日期" />
            {rangeMode && (
              <>
                <span className="pub-arrow">→</span>
                <DatePicker value={end} onChange={setEnd} title="结束日期" />
              </>
            )}
            <span className="rp-range-pill">{dates.length} 天</span>
          </div>
          {dates.length > 0 && dates.length <= 31 && (
            <div className="pub-chips">
              {dates.map((d) => {
                const have = existing[d] ?? 0
                const rest = weekdayOf(d) === '六' || weekdayOf(d) === '日'
                return (
                  <span key={d} className={'pub-chip' + (rest ? ' rest' : '')}>
                    {d.slice(5)}
                    <i>{weekdayOf(d)}</i>
                    <b>{have > 0 ? `${have} → ${have + ready.length}` : `+${ready.length}`}</b>
                  </span>
                )
              })}
            </div>
          )}
          {overlapDays.length > 0 && (
            <p className="pub-warn">
              <Info size={13} />
              {overlapDays
                .slice(0, 3)
                .map((d) => d.slice(5))
                .join('、')}
              {overlapDays.length > 3 ? ' 等' : ''} 已有任务，发布会追加而非覆盖；如需改期请到日报页用「延期」。
            </p>
          )}
        </section>
      </div>

      {/* 右：发布预览 */}
      <aside className="pub-preview">
        <div className="ps-head">
          <span>发布预览</span>
        </div>
        <div className="pub-pv-days">
          {dates.map((d) => {
            const have = existing[d] ?? 0
            return (
              <div key={d} className="pub-pv-day">
                <span className="pub-pv-date">{d.slice(5)}</span>
                <span className="pub-pv-wd">{weekdayOf(d)}</span>
                <span className="pub-pv-flow">
                  {have} → {have + ready.length}
                </span>
              </div>
            )
          })}
          {dates.length === 0 && <p className="ps-empty">先选择发布日期</p>}
        </div>
        <div className="st-kv">
          <span>将写入</span>
          <b>
            {dates.length} 天 · {totalCopies} 条副本
          </b>
        </div>
        <div className="st-kv">
          <span>任务条数</span>
          <b>
            {ready.length} / {drafts.length}
          </b>
        </div>
        <div className="st-kv">
          <span>每条独立</span>
          <b>标题 / 正文 / 标签 / 子任务</b>
        </div>
        <div className="st-kv">
          <span>整批共享</span>
          <b>发布日期</b>
        </div>
        <button
          className="btn btn--primary pub-submit"
          onClick={() => void publish()}
          disabled={!canPublish}
        >
          <Send size={15} />
          确认发布
        </button>
        <p className="ps-hint">
          发布后可在日报页按天查看；修改任意一天的任务内容会同步到区间内全部副本。
        </p>
      </aside>
    </div>
  )
}

function fmtRange(dates: string[]): string {
  if (dates.length === 0) return '—'
  if (dates.length === 1) return dates[0].slice(5)
  return `${dates[0].slice(5)} ~ ${dates[dates.length - 1].slice(5)}`
}
