import { useEffect, useState } from 'react'
import type { PublishRecord, Subtask, Tag, Task } from '../types'
import { enumerateDates, toDateStr, weekInfoOf, type PublishGranularity } from '../utils/date'
import MarkdownEditor from './MarkdownEditor'
import RichView from './RichView'
import TagPicker from './TagPicker'
import Modal from './Modal'
import Drawer from './Drawer'
import DatePicker from './DatePicker'

interface TaskPublishProps {
  tags: Tag[]
  onStatus: (msg: string) => void
  onPublished: () => void
  onGoToTags: () => void
}

const GRANULARITY_OPTIONS: { value: PublishGranularity; label: string }[] = [
  { value: 'day', label: '按日' },
  { value: 'week', label: '按周' },
  { value: 'month', label: '按月' },
  { value: 'year', label: '按年' }
]

/** 判断某日是否落在「锚点日期」的指定粒度周期内 */
function inPeriod(dateStr: string, anchor: string, g: PublishGranularity): boolean {
  if (g === 'day') return dateStr === anchor
  if (g === 'week') return weekInfoOf(dateStr).weekKey === weekInfoOf(anchor).weekKey
  if (g === 'month') return dateStr.slice(0, 7) === anchor.slice(0, 7)
  return dateStr.slice(0, 4) === anchor.slice(0, 4)
}

/** 粒度对应的范围说明 */
function histRangeLabel(g: PublishGranularity, anchor: string): string {
  if (!anchor) return ''
  if (g === 'day') return `单日：${anchor}`
  if (g === 'week') {
    const wi = weekInfoOf(anchor)
    return `第 ${wi.week} 周：${wi.start} ~ ${wi.end}`
  }
  if (g === 'month') return `月度：${anchor.slice(0, 7)}`
  return `年度：${anchor.slice(0, 4)}`
}

/** 待发布任务（批量派发列表中的一项） */
interface PendingTask {
  localId: string
  title: string
  tags: string[]
  subtasks: Subtask[]
  body: string
  rangeMode: boolean
  singleDate: string
  start: string
  end: string
}

function newPending(): PendingTask {
  const today = toDateStr(new Date())
  return {
    localId: crypto.randomUUID(),
    title: '',
    tags: [],
    subtasks: [],
    body: '',
    rangeMode: false,
    singleDate: today,
    start: today,
    end: today
  }
}

/** 子任务编辑器（待发布条目内使用） */
function SubtaskEditor({
  subtasks,
  tags,
  onChange
}: {
  subtasks: Subtask[]
  tags: Tag[]
  onChange: (subs: Subtask[]) => void
}) {
  const [subInput, setSubInput] = useState('')
  const [openSubtag, setOpenSubtag] = useState<string | null>(null)

  function addSub(): void {
    const v = subInput.trim()
    if (!v) return
    onChange([...subtasks, { id: crypto.randomUUID(), title: v, done: false, tags: [] }])
    setSubInput('')
  }

  return (
    <div className="subtask-editor">
      <div className="subtask-add-row">
        <input
          className="subtask-add-input"
          placeholder="添加子任务（回车添加）"
          value={subInput}
          onChange={(e) => setSubInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addSub()
          }}
        />
        <button className="icon-btn primary" title="添加子任务" onClick={addSub}>
          ＋
        </button>
      </div>
      {subtasks.length > 0 && (
        <div className="subtask-list">
          {subtasks.map((st) => (
            <div key={st.id} className={'subtask-row' + (st.done ? ' done' : '')}>
              <input
                type="checkbox"
                className="task-check"
                checked={st.done}
                onChange={() =>
                  onChange(subtasks.map((s) => (s.id === st.id ? { ...s, done: !s.done } : s)))
                }
              />
              <span className="subtask-title">{st.title}</span>
              <span className="subtask-tags">
                {st.tags.map((id) => {
                  const t = tags.find((x) => x.id === id)
                  if (!t) return null
                  return (
                    <span
                      key={id}
                      className="task-item-tag"
                      style={{ borderColor: t.color, color: t.color }}
                    >
                      {t.name}
                    </span>
                  )
                })}
              </span>
              <button
                className="tag-add-chip"
                onClick={() => setOpenSubtag(openSubtag === st.id ? null : st.id)}
                title="添加标签"
              >
                + 标签
              </button>
              <button
                className="icon-btn danger"
                title="删除子任务"
                onClick={() => onChange(subtasks.filter((s) => s.id !== st.id))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {openSubtag && (
        <div className="subtask-tag-menu">
          {tags.map((t) => {
            const st = subtasks.find((s) => s.id === openSubtag)
            const active = st?.tags.includes(t.id)
            return (
              <button
                key={t.id}
                className={'subtask-tag-item' + (active ? ' active' : '')}
                onClick={() => {
                  onChange(
                    subtasks.map((s) => {
                      if (s.id !== openSubtag) return s
                      const has = s.tags.includes(t.id)
                      return {
                        ...s,
                        tags: has ? s.tags.filter((x) => x !== t.id) : [...s.tags, t.id]
                      }
                    })
                  )
                }}
              >
                <span className="tag-dot" style={{ background: t.color }} />
                {t.name}
                {active && ' ✓'}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 待发布条目卡片 */
function PendingTaskCard({
  value,
  tags,
  onChange,
  onRemove,
  onGoToTags,
  onStatus
}: {
  value: PendingTask
  tags: Tag[]
  onChange: (patch: Partial<PendingTask>) => void
  onRemove: () => void
  onGoToTags: () => void
  onStatus: (msg: string) => void
}) {
  const [showSubtasks, setShowSubtasks] = useState(false)
  const [showBody, setShowBody] = useState(false)

  return (
    <div className="pending-card">
      <div className="pending-card-head">
        <input
          className="publish-title"
          placeholder="任务标题"
          value={value.title}
          autoFocus
          onChange={(e) => onChange({ title: e.target.value })}
        />
        <button className="icon-btn danger" onClick={onRemove} title="移除该条">
          ✕
        </button>
      </div>

      <TagPicker
        selectedIds={value.tags}
        allTags={tags}
        onChange={(ids) => onChange({ tags: ids })}
        onGoToTags={onGoToTags}
      />

      <div className="publish-dates">
        <div className="publish-mode">
          <label>
            <input
              type="radio"
              checked={!value.rangeMode}
              onChange={() => onChange({ rangeMode: false })}
            />
            单日
          </label>
          <label>
            <input
              type="radio"
              checked={value.rangeMode}
              onChange={() => onChange({ rangeMode: true })}
            />
            区间
          </label>
        </div>
        {value.rangeMode ? (
          <div className="publish-range">
            <DatePicker value={value.start} onChange={(v) => onChange({ start: v })} title="起始日期" />
            <span>至</span>
            <DatePicker value={value.end} onChange={(v) => onChange({ end: v })} title="结束日期" />
          </div>
        ) : (
          <DatePicker
            value={value.singleDate}
            onChange={(v) => onChange({ singleDate: v })}
            title="发布日期"
          />
        )}
      </div>

      <div className="pending-toggles">
        <button className="ghost-btn" onClick={() => setShowSubtasks((v) => !v)}>
          子任务 {showSubtasks ? '▴' : '▾'}
        </button>
        <button className="ghost-btn" onClick={() => setShowBody((v) => !v)}>
          正文 {showBody ? '▴' : '▾'}
        </button>
      </div>
      {showSubtasks && (
        <SubtaskEditor
          subtasks={value.subtasks}
          tags={tags}
          onChange={(subs) => onChange({ subtasks: subs })}
        />
      )}
      {showBody && (
        <MarkdownEditor
          value={value.body}
          onChange={(b) => onChange({ body: b })}
          attachFolder="publish"
          onStatus={onStatus}
        />
      )}
    </div>
  )
}

export default function TaskPublish({ tags, onStatus, onPublished, onGoToTags }: TaskPublishProps) {
  const [showForm, setShowForm] = useState(false)
  const [pending, setPending] = useState<PendingTask[]>([])
  const [history, setHistory] = useState<PublishRecord[]>([])
  const [detail, setDetail] = useState<PublishRecord | null>(null)
  const [detailInstances, setDetailInstances] = useState<{ date: string; task: Task }[]>([])
  const [query, setQuery] = useState('')
  // 发布历史粒度筛选（独立于发布表单）
  const [histGran, setHistGran] = useState<PublishGranularity>('month')
  const [histDate, setHistDate] = useState(toDateStr(new Date()))

  // 已发布任务列表
  const [pubTab, setPubTab] = useState<'history' | 'published'>('published')
  const [published, setPublished] = useState<{ date: string; task: Task }[]>([])
  const [editingTask, setEditingTask] = useState<{ date: string; task: Task } | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editTags, setEditTags] = useState<string[]>([])

  useEffect(() => {
    window.api.listPublishHistory().then(setHistory)
  }, [])

  async function refreshPublished(): Promise<void> {
    const dates = await window.api.listTaskDates()
    if (dates.length === 0) {
      setPublished([])
      return
    }
    const map = await window.api.readTasksMany(dates)
    const list: { date: string; task: Task }[] = []
    for (const [d, ts] of Object.entries(map)) {
      for (const t of ts) {
        list.push({ date: d, task: t })
      }
    }
    list.sort((a, b) => (a.date < b.date ? 1 : -1))
    setPublished(list)
  }

  useEffect(() => {
    refreshPublished()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function togglePublished(entry: { date: string; task: Task }): Promise<void> {
    await window.api.updateTask(entry.date, entry.task.id, { done: !entry.task.done })
    onPublished()
    refreshPublished()
  }

  async function deletePublished(entry: { date: string; task: Task }): Promise<void> {
    if (window.confirm(`删除任务「${entry.task.title}」（含其在所有天的实例）？将移入临时回收站。`)) {
      await window.api.trashTask(entry.date, entry.task.id)
      onPublished()
      refreshPublished()
      onStatus('已移入回收站')
    }
  }

  function openEdit(entry: { date: string; task: Task }): void {
    setEditingTask(entry)
    setEditTitle(entry.task.title)
    setEditBody(entry.task.body)
    setEditTags(entry.task.tags)
  }

  async function saveEdit(): Promise<void> {
    if (!editingTask) return
    if (!editTitle.trim()) {
      onStatus('请填写任务标题')
      return
    }
    await window.api.updateTask(editingTask.date, editingTask.task.id, {
      title: editTitle.trim(),
      body: editBody,
      tags: editTags
    })
    setEditingTask(null)
    onPublished()
    refreshPublished()
    onStatus('已保存任务（所有天同步）')
  }

  function refreshHistory(): void {
    window.api.listPublishHistory().then(setHistory)
  }

  function openForm(): void {
    setPending([newPending()])
    setShowForm(true)
  }

  function closeForm(): void {
    setShowForm(false)
  }

  function addPending(): void {
    setPending((prev) => [...prev, newPending()])
  }

  function removePending(localId: string): void {
    setPending((prev) => prev.filter((p) => p.localId !== localId))
  }

  function updatePending(localId: string, patch: Partial<PendingTask>): void {
    setPending((prev) => prev.map((p) => (p.localId === localId ? { ...p, ...patch } : p)))
  }

  /** 统一发布待发布列表中的全部任务 */
  async function publishAll(): Promise<void> {
    const valid = pending.filter((p) => p.title.trim())
    if (valid.length === 0) {
      onStatus('请至少填写一个任务标题')
      return
    }
    if (valid.length !== pending.length) {
      onStatus(`有 ${pending.length - valid.length} 条未填标题已跳过，请补全后可再次发布`)
    }
    let okCount = 0
    for (const p of valid) {
      let dates: string[]
      if (p.rangeMode) {
        if (!p.start || !p.end || p.end < p.start) {
          onStatus(`「${p.title}」结束日期不能早于开始日期，已跳过`)
          continue
        }
        dates = enumerateDates(p.start, p.end)
      } else {
        dates = [p.singleDate]
      }
      if (dates.length === 0) {
        onStatus(`「${p.title}」没有可发布的日期，已跳过`)
        continue
      }
      await window.api.publishTasks(dates, {
        title: p.title.trim(),
        tags: p.tags,
        body: p.body,
        subtasks: p.subtasks
      })
      okCount++
    }
    onStatus(`已发布 ${okCount} 个任务`)
    onPublished()
    refreshHistory()
    refreshPublished()
    closeForm()
  }

  async function removeRecord(rec: PublishRecord): Promise<void> {
    if (window.confirm(`删除发布记录「${rec.title}」？该次发布的所有任务实例将移入回收站。`)) {
      await window.api.trashPublishRecord(rec.id)
      if (detail?.id === rec.id) setDetail(null)
      refreshHistory()
      onPublished()
      onStatus('已移入回收站')
    }
  }

  async function openDetail(rec: PublishRecord): Promise<void> {
    setDetail(rec)
    const list: { date: string; task: Task }[] = []
    for (const inst of rec.instances ?? []) {
      const tasks = await window.api.readTasks(inst.date)
      const task = tasks.find((t) => t.id === inst.taskId)
      if (task) list.push({ date: inst.date, task })
    }
    setDetailInstances(list)
  }

  async function deleteInstance(date: string, task: Task): Promise<void> {
    if (window.confirm(`删除任务「${task.title}」（含其在所有天的实例）？将移入临时回收站。`)) {
      await window.api.trashTask(date, task.id)
      refreshHistory()
      refreshPublished()
      onPublished()
      onStatus('已移入回收站')
      if (detail) void openDetail(detail)
    }
  }

  function fmtDates(dates: string[]): string {
    if (dates.length === 0) return ''
    if (dates.length === 1) return dates[0]
    return `${dates[0]} ~ ${dates[dates.length - 1]}（共 ${dates.length} 个）`
  }

  const tagById = new Map(tags.map((t) => [t.id, t]))

  const filteredHistory = history.filter((rec) => {
    const pubDate = toDateStr(new Date(rec.publishedAt))
    if (!inPeriod(pubDate, histDate, histGran)) return false
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()
    return (
      rec.title.toLowerCase().includes(q) ||
      rec.tags.some((id) => tagById.get(id)?.name.includes(query.trim()))
    )
  })

  return (
    <div className="publish-view">
      <div className="date-heading">
        <h2>任务发布</h2>
        <button className="ghost-btn" onClick={openForm}>
          ➕ 发布任务
        </button>
        <span className="weekday">支持批量多任务派发；发布后自动同步到所选日期的日报中</span>
      </div>

      <div className="publish-tabs">
        <button
          className={pubTab === 'published' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setPubTab('published')}
        >
          已发布任务
        </button>
        <button
          className={pubTab === 'history' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setPubTab('history')}
        >
          发布历史
        </button>
      </div>

      {pubTab === 'published' && (
        <div className="published-list">
          {published.length === 0 ? (
            <div className="task-empty">暂无已发布任务</div>
          ) : (
            published.map((entry) => (
              <div key={entry.task.id + entry.date} className={'publish-record' + (entry.task.done ? ' done' : '')}>
                <div className="publish-record-main">
                  <span className="publish-record-title">{entry.task.title || '（未命名）'}</span>
                  <span className="publish-record-meta">
                    {entry.date} · 派发 {new Date(entry.task.publishedAt).toLocaleString()}
                  </span>
                  {entry.task.completedAt && (
                    <span className="publish-record-time">
                      完成于 {new Date(entry.task.completedAt).toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="publish-record-tags">
                  {entry.task.tags.map((id) => {
                    const t = tagById.get(id)
                    if (!t) return null
                    return (
                      <span key={id} className="task-item-tag" style={{ borderColor: t.color, color: t.color }}>
                        {t.name}
                      </span>
                    )
                  })}
                </div>
                <div className="publish-record-actions" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="task-check"
                    checked={entry.task.done}
                    onChange={() => togglePublished(entry)}
                    title="勾选完成"
                  />
                  <button className="icon-btn" onClick={() => openEdit(entry)} title="编辑任务（所有天同步）">
                    ✏️
                  </button>
                  <button className="icon-btn danger" onClick={() => deletePublished(entry)} title="删除任务（进回收站）">
                    🗑
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {pubTab === 'history' && (
        <div className="publish-history">
          <div className="publish-history-head">
            <h3>发布历史</h3>
            <div className="publish-filter">
              <select
                className="gran-select"
                value={histGran}
                onChange={(e) => setHistGran(e.target.value as PublishGranularity)}
                title="筛选粒度"
              >
                {GRANULARITY_OPTIONS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
              <DatePicker value={histDate} onChange={setHistDate} title="筛选时间段" />
              <span className="publish-preview muted">{histRangeLabel(histGran, histDate)}</span>
            </div>
            <input
              className="publish-search"
              placeholder="搜索标题或标签…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {filteredHistory.length === 0 ? (
            <div className="task-empty">
              {query.trim() ? '没有匹配的发布记录' : '该时间段暂无发布记录'}
            </div>
          ) : (
            filteredHistory.map((rec) => (
              <div
                key={rec.id}
                className="publish-record"
                onClick={() => void openDetail(rec)}
                title="点击查看详情"
              >
                <div className="publish-record-main">
                  <span className="publish-record-title">{rec.title}</span>
                  <span className="publish-record-meta">{fmtDates(rec.dates)}</span>
                  <span className="publish-record-time">
                    {new Date(rec.publishedAt).toLocaleString()}
                  </span>
                </div>
                <div className="publish-record-tags">
                  {rec.tags.map((id) => {
                    const t = tagById.get(id)
                    if (!t) return null
                    return (
                      <span
                        key={id}
                        className="task-item-tag"
                        style={{ borderColor: t.color, color: t.color }}
                      >
                        {t.name}
                      </span>
                    )
                  })}
                </div>
                <div className="publish-record-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="icon-btn danger"
                    onClick={() => removeRecord(rec)}
                    title="删除该条记录（进回收站）"
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <Modal open={showForm} title="发布任务（支持批量）" width={900} onClose={closeForm}>
        <div className="publish-form">
          <div className="pending-list">
            {pending.map((p) => (
              <PendingTaskCard
                key={p.localId}
                value={p}
                tags={tags}
                onChange={(patch) => updatePending(p.localId, patch)}
                onRemove={() => removePending(p.localId)}
                onGoToTags={onGoToTags}
                onStatus={onStatus}
              />
            ))}
          </div>
          <div className="pending-actions">
            <button className="ghost-btn" onClick={addPending}>
              ➕ 添加任务
            </button>
            <button className="publish-btn" onClick={() => void publishAll()} disabled={pending.length === 0}>
              全部发布（{pending.length}）
            </button>
          </div>
        </div>
      </Modal>

      <Drawer open={detail !== null} title="发布详情" onClose={() => setDetail(null)}>
        {detail && (
          <div className="publish-detail">
            <h3 className="publish-detail-title">{detail.title}</h3>
            <div className="tag-chips">
              {detail.tags.map((id) => {
                const t = tagById.get(id)
                if (!t) return null
                return (
                  <span
                    key={id}
                    className="task-item-tag"
                    style={{ borderColor: t.color, color: t.color }}
                  >
                    {t.name}
                  </span>
                )
              })}
              {detail.tags.length === 0 && <span className="muted">（无标签）</span>}
            </div>
            <div className="publish-detail-meta">
              <div>目标日期：{fmtDates(detail.dates)}</div>
              <div>发布时间：{new Date(detail.publishedAt).toLocaleString()}</div>
            </div>

            <div className="detail-instances">
              <div className="detail-instances-label">该批任务实例（可编辑 / 删除）：</div>
              {detailInstances.length === 0 ? (
                <div className="task-empty">该记录暂无任务实例（可能是旧版数据）</div>
              ) : (
                detailInstances.map(({ date, task }) => (
                  <div key={task.id + date} className={'publish-record' + (task.done ? ' done' : '')}>
                    <div className="publish-record-main">
                      <span className="publish-record-title">{task.title || '（未命名）'}</span>
                      <span className="publish-record-meta">
                        {date} · 派发 {new Date(task.publishedAt).toLocaleString()}
                      </span>
                      {task.completedAt && (
                        <span className="publish-record-time">
                          完成于 {new Date(task.completedAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="publish-record-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="icon-btn" onClick={() => openEdit({ date, task })} title="编辑任务（所有天同步）">
                        ✏️
                      </button>
                      <button className="icon-btn danger" onClick={() => void deleteInstance(date, task)} title="删除任务（进回收站）">
                        🗑
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {(detail.subtasks ?? []).length > 0 && (
              <div className="subtask-list read">
                {(detail.subtasks ?? []).map((st) => (
                  <div key={st.id} className={'subtask-row' + (st.done ? ' done' : '')}>
                    <span className="subtask-check">{st.done ? '☑' : '☐'}</span>
                    <span className="subtask-title">{st.title}</span>
                    <span className="subtask-tags">
                      {st.tags.map((id) => {
                        const t = tagById.get(id)
                        if (!t) return null
                        return (
                          <span
                            key={id}
                            className="task-item-tag"
                            style={{ borderColor: t.color, color: t.color }}
                          >
                            {t.name}
                          </span>
                        )
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {detail.body ? (
              <RichView content={detail.body} />
            ) : (
              <div className="task-empty">该记录无正文（旧版发布记录）</div>
            )}
          </div>
        )}
      </Drawer>

      <Modal open={editingTask !== null} title="编辑任务" width={760} onClose={() => setEditingTask(null)}>
        <div className="publish-form">
          <input
            className="publish-title"
            placeholder="任务标题"
            value={editTitle}
            autoFocus
            onChange={(e) => setEditTitle(e.target.value)}
          />
          <TagPicker
            selectedIds={editTags}
            allTags={tags}
            onChange={setEditTags}
            onGoToTags={onGoToTags}
          />
          <div className="publish-body">
            <MarkdownEditor
              value={editBody}
              onChange={setEditBody}
              attachFolder="publish"
              onStatus={onStatus}
            />
          </div>
          <div className="publish-actions">
            <button className="publish-btn" onClick={saveEdit}>
              保存
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
