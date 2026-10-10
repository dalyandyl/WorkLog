import { useEffect, useState } from 'react'
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  Plus,
  Square,
  StickyNote
} from 'lucide-react'
import type { PublishRecord, StatusReporter, Tag, Task } from '../../types'
import { enumerateDates, toDateStr, type PublishGranularity } from '../../utils/date'
import Modal from '../Modal'
import Drawer from '../Drawer'
import DatePicker from '../DatePicker'
import DropdownSelect from '../DropdownSelect'
import PostponeModal from '../PostponeModal'
import RichView from '../RichView'
import TagBadgeList from '../TagBadge'
import PendingTaskCard from './PendingTaskCard'
import PublishedList, { type PublishedEntry } from './PublishedList'
import {
  GRANULARITY_OPTIONS,
  PUBLISH_WINDOW_DAYS,
  PUBLISH_WINDOW_STEP,
  fmtDates,
  histRangeLabel,
  inPeriod,
  loadPendingDraft,
  newPending,
  savePendingDraft,
  type PendingTask
} from './types'

interface TaskPublishProps {
  tags: Tag[]
  onStatus: StatusReporter
  onPublished: () => void
  onGoToTags: () => void
  /** 数据变更版本号：变化时重新拉取已发布列表与发布历史 */
  dataVersion?: number
}

export default function TaskPublish({
  tags,
  onStatus,
  onPublished,
  onGoToTags,
  dataVersion = 0
}: TaskPublishProps) {
  const [pending, setPending] = useState<PendingTask[]>(loadPendingDraft)
  // 有恢复的草稿时直接展开表单（pending 的初始化在本行之前，可安全读取）
  const [showForm, setShowForm] = useState(() => pending.length > 0)
  const [history, setHistory] = useState<PublishRecord[]>([])
  const [detail, setDetail] = useState<PublishRecord | null>(null)
  const [detailInstances, setDetailInstances] = useState<{ date: string; task: Task }[]>([])
  const [query, setQuery] = useState('')
  // 发布历史粒度筛选（独立于发布表单）
  const [histGran, setHistGran] = useState<PublishGranularity>('month')
  const [histDate, setHistDate] = useState(toDateStr(new Date()))

  // 已发布任务列表（只读查看 + 勾选完成）
  const [pubTab, setPubTab] = useState<'history' | 'published'>('published')
  const [published, setPublished] = useState<{ date: string; task: Task }[]>([])
  const [viewEntry, setViewEntry] = useState<{ date: string; task: Task } | null>(null)
  // 延期弹窗当前条目（null = 关闭）
  const [postponeEntry, setPostponeEntry] = useState<{ date: string; task: Task } | null>(null)
  /** 已发布任务的加载窗口（天）——避免一次性读取全部历史 */
  const [pubWindow, setPubWindow] = useState(PUBLISH_WINDOW_DAYS)
  /** 有任务的总天数，用于提示"当前只显示了窗口内的部分" */
  const [pubTotalDays, setPubTotalDays] = useState(0)

  useEffect(() => {
    let cancelled = false
    window.api.listPublishHistory().then((h) => {
      if (!cancelled) setHistory(h)
    })
    void loadPublished(PUBLISH_WINDOW_DAYS, () => cancelled)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion])

  // 待发布草稿持久化：切换视图（组件被卸载）或重启应用后内容仍在
  useEffect(() => {
    savePendingDraft(pending)
  }, [pending])

  /**
   * 读取"最近 windowDays 天"内已发布的任务。
   *
   * 旧实现是 `readTasksMany(listTaskDates())`：把所有历史天文件全读进内存再拍平渲染，
   * 数据量增长后既是最大卡顿点也是最大内存点。现在只读最近一个窗口，
   * 更早的内容由用户点「加载更多」按需追加；同时补上卸载后的 cancelled 守卫。
   */
  async function loadPublished(windowDays: number, isCancelled: () => boolean): Promise<void> {
    const dates = await window.api.listTaskDates()
    if (isCancelled()) return
    const cutoff = toDateStr(new Date(Date.now() - (windowDays - 1) * 86400000))
    const inWindow = dates.filter((d) => d >= cutoff)
    setPubTotalDays(dates.length)
    if (inWindow.length === 0) {
      setPublished([])
      return
    }
    const map = await window.api.readTasksMany(inWindow)
    if (isCancelled()) return
    const list: { date: string; task: Task }[] = []
    for (const [d, ts] of Object.entries(map)) {
      for (const t of ts) {
        list.push({ date: d, task: t })
      }
    }
    list.sort((a, b) => (a.date < b.date ? 1 : -1))
    setPublished(list)
  }

  /** 供操作后刷新使用：沿用当前窗口 */
  async function refreshPublished(): Promise<void> {
    await loadPublished(pubWindow, () => false)
  }

  function loadMorePublished(): void {
    const next = pubWindow + PUBLISH_WINDOW_STEP
    setPubWindow(next)
    void loadPublished(next, () => false)
  }

  async function togglePublished(entry: { date: string; task: Task }): Promise<void> {
    await window.api.updateTask(entry.date, entry.task.id, { done: !entry.task.done })
    onPublished()
    refreshPublished()
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
      onStatus('请至少填写一个任务标题', 'error')
      return
    }
    if (valid.length !== pending.length) {
      onStatus(`有 ${pending.length - valid.length} 条未填标题已跳过，请补全后可再次发布`, 'error')
    }
    let okCount = 0
    for (const p of valid) {
      let dates: string[]
      if (p.rangeMode) {
        if (!p.start || !p.end || p.end < p.start) {
          onStatus(`「${p.title}」结束日期不能早于开始日期，已跳过`, 'error')
          continue
        }
        dates = enumerateDates(p.start, p.end)
      } else {
        dates = [p.singleDate]
      }
      if (dates.length === 0) {
        onStatus(`「${p.title}」没有可发布的日期，已跳过`, 'error')
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
    // 全部成功才清空草稿；有被跳过/未填标题的条目则保留，方便用户补全后重发
    if (valid.length === pending.length && okCount === valid.length) {
      setPending([])
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
          <Plus size={14} />
          发布任务
        </button>
        <span className="weekday">支持批量多任务派发；发布后自动同步到所选日期的日报中</span>
      </div>

      <div className="publish-tabs" role="tablist" aria-label="任务发布视图">
        <button
          role="tab"
          aria-selected={pubTab === 'published'}
          className={pubTab === 'published' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setPubTab('published')}
        >
          已发布任务
        </button>
        <button
          role="tab"
          aria-selected={pubTab === 'history'}
          className={pubTab === 'history' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setPubTab('history')}
        >
          发布历史
        </button>
      </div>

      {pubTab === 'published' && (
        <PublishedList
          published={published}
          pubWindow={pubWindow}
          pubTotalDays={pubTotalDays}
          tagMap={tagById}
          onOpen={setViewEntry}
          onPostpone={setPostponeEntry}
          onToggleDone={(entry) => void togglePublished(entry)}
          onLoadMore={loadMorePublished}
        />
      )}

      {pubTab === 'history' && (
        <div className="publish-history">
          <div className="publish-history-head">
            <h3>发布历史</h3>
            <div className="publish-filter">
              <DropdownSelect
                value={histGran}
                options={GRANULARITY_OPTIONS}
                onChange={(v) => setHistGran(v as PublishGranularity)}
                title="筛选粒度"
              />
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
            <div className="publish-history-list">
              {filteredHistory.map((rec) => (
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
                  <TagBadgeList ids={rec.tags} tagMap={tagById} />
                </div>
              </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Modal open={showForm} title="发布任务（支持批量）" width={1080} height={680} onClose={closeForm}>
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
              <Plus size={14} />
              添加任务
            </button>
            <button className="publish-btn" onClick={() => void publishAll()} disabled={pending.length === 0}>
              全部发布（{pending.length}）
            </button>
          </div>
        </div>
      </Modal>

      <Drawer open={viewEntry !== null} title="已发布任务详情" onClose={() => setViewEntry(null)}>
        {viewEntry && (
          <div className="publish-detail">
            <h3 className="publish-detail-title">{viewEntry.task.title || '未命名任务'}</h3>
            {!viewEntry.task.done && (
              <div className="publish-detail-actions">
                <button className="ghost-btn" onClick={() => setPostponeEntry(viewEntry)}>
                  <CalendarClock size={14} />
                  延期（追加区间）
                </button>
              </div>
            )}
            <div className="task-time-info">
              <span>
                <CalendarDays size={13} />
                派发：{new Date(viewEntry.task.publishedAt).toLocaleString()}
              </span>
              {viewEntry.task.completedAt && (
                <span>
                  <CheckCircle2 size={13} />
                  完成：{new Date(viewEntry.task.completedAt).toLocaleString()}
                </span>
              )}
            </div>
            <div className="tag-chips">
              <TagBadgeList ids={viewEntry.task.tags} tagMap={tagById} />
              {viewEntry.task.tags.length === 0 && <span className="muted">（无标签）</span>}
            </div>
            {(viewEntry.task.subtasks ?? []).length > 0 && (
              <div className="subtask-list read">
                {(viewEntry.task.subtasks ?? []).map((st) => (
                  <div key={st.id} className={'subtask-row' + (st.done ? ' done' : '')}>
                    <span className="subtask-check">{st.done ? <CheckSquare size={13} /> : <Square size={13} />}</span>
                    <span className="subtask-title">{st.title}</span>
                    <span className="subtask-tags">
                      <TagBadgeList ids={st.tags} tagMap={tagById} />
                    </span>
                  </div>
                ))}
              </div>
            )}
            {viewEntry.task.note && viewEntry.task.note.trim() && (
              <div className="task-note">
                <div className="task-note-label">
                  <StickyNote size={13} />
                  备注
                </div>
                <div className="task-note-view">{viewEntry.task.note}</div>
              </div>
            )}
            {viewEntry.task.body ? (
              <RichView content={viewEntry.task.body} />
            ) : (
              <div className="task-empty">暂无正文</div>
            )}
          </div>
        )}
      </Drawer>

      <Drawer open={detail !== null} title="发布详情" onClose={() => setDetail(null)}>
        {detail && (
          <div className="publish-detail">
            <h3 className="publish-detail-title">{detail.title}</h3>
            <div className="tag-chips">
              <TagBadgeList ids={detail.tags} tagMap={tagById} />
              {detail.tags.length === 0 && <span className="muted">（无标签）</span>}
            </div>
            <div className="publish-detail-meta">
              <div>目标日期：{fmtDates(detail.dates)}</div>
              <div>发布时间：{new Date(detail.publishedAt).toLocaleString()}</div>
            </div>

            {detailInstances.length > 0 && (
              <div className="detail-instances">
                <div className="detail-instances-label">该批任务实例：</div>
                {detailInstances.map(({ date, task }) => (
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
                    {!task.done && (
                      <div className="publish-record-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="icon-btn"
                          onClick={() => setPostponeEntry({ date, task })}
                          title="延期（追加自定义区间，所有天同步）"
                        >
                          <CalendarClock size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {(detail.subtasks ?? []).length > 0 && (
              <div className="subtask-list read">
                {(detail.subtasks ?? []).map((st) => (
                  <div key={st.id} className={'subtask-row' + (st.done ? ' done' : '')}>
                    <span className="subtask-check">{st.done ? <CheckSquare size={13} /> : <Square size={13} />}</span>
                    <span className="subtask-title">{st.title}</span>
                    <span className="subtask-tags">
                      <TagBadgeList ids={st.tags} tagMap={tagById} />
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

      <PostponeModal
        open={postponeEntry !== null}
        task={postponeEntry?.task ?? null}
        entryDate={postponeEntry?.date ?? ''}
        onClose={() => setPostponeEntry(null)}
        onPostponed={() => {
          refreshPublished()
          onPublished()
        }}
        onStatus={onStatus}
      />
    </div>
  )
}
