import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { Clock, Link2, List, PenLine, Plus, Save, Sparkles, Trash2, X } from 'lucide-react'
import type {
  AttachmentMeta,
  JournalDay,
  JournalEntry,
  JournalEntryInput,
  MountedTask,
  StatusReporter,
  Task
} from '../types'
import RichTextEditor from './RichTextEditor'
import RichView from './RichView'
import Modal from './Modal'

interface JournalViewProps {
  /** 当前选中的日期（按天模式用；与左侧日历联动） */
  date: string
  onStatus?: StatusReporter
  /** 数据版本号：变化时重新加载（例如从回收站恢复后） */
  dataVersion?: number
  /** 点击挂载任务行时跳转到该任务 */
  onOpenTask?: (date: string, taskId: string) => void
}

/** 时间线模式一次加载的天数 */
const TIMELINE_PAGE = 20

/** 一条正在编辑的草稿 */
interface Draft {
  /** null = 新建 */
  id: string | null
  time: string
  body: string
  attachments: AttachmentMeta[]
  mountedTasks: MountedTask[]
}

function nowHHmm(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function emptyDraft(): Draft {
  return { id: null, time: nowHHmm(), body: '', attachments: [], mountedTasks: [] }
}

function draftFromEntry(e: JournalEntry): Draft {
  return {
    id: e.id,
    time: e.time || nowHHmm(),
    body: e.body,
    attachments: [...e.attachments],
    mountedTasks: [...e.mountedTasks]
  }
}

/**
 * 日志页面。
 *
 * - **默认按天**：跟随左侧日历选中的日期，列出当天的条目（按时间升序）。
 * - **时间线**：连续跨天倒序浏览，可继续「加载更早」。
 * - 每条条目可**行内编辑**（新建也是同一套草稿区），可挂载当天的任务（一行快照）。
 *
 * 与任务模块**相互独立**：这里不修改任何任务数据，挂载只读取任务快照。
 */
export default function JournalView({
  date,
  onStatus,
  dataVersion,
  onOpenTask
}: JournalViewProps): React.JSX.Element {
  const [viewMode, setViewMode] = useState<'day' | 'timeline'>('day')
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [timeline, setTimeline] = useState<JournalDay[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pickOpen, setPickOpen] = useState(false)
  const [dayTasks, setDayTasks] = useState<Task[]>([])
  const editorRef = useRef<Editor | null>(null)
  // 保存进行中时禁用按钮，避免重复提交
  const savingRef = useRef(false)

  // ---- 加载：按天 ----
  const loadDay = useCallback(
    async (d: string): Promise<void> => {
      setLoading(true)
      try {
        const day = await window.api.readJournalDay(d)
        setEntries(day.entries)
      } catch (err) {
        console.error('readJournalDay failed:', err)
        onStatus?.('读取日志失败', 'error')
        setEntries([])
      } finally {
        setLoading(false)
      }
    },
    [onStatus]
  )

  // ---- 加载：时间线（首屏） ----
  const loadTimeline = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setTimeline(await window.api.listJournalRange({ limit: TIMELINE_PAGE }))
    } catch (err) {
      console.error('listJournalRange failed:', err)
      onStatus?.('读取日志失败', 'error')
      setTimeline([])
    } finally {
      setLoading(false)
    }
  }, [onStatus])

  useEffect(() => {
    if (viewMode === 'day') void loadDay(date)
    else void loadTimeline()
  }, [viewMode, date, dataVersion, loadDay, loadTimeline])

  // 切换日期/视图时丢弃未保存的草稿，避免写到错误的日期上
  useEffect(() => {
    setDraft(null)
  }, [date])

  /** 时间线追加更早的内容 */
  async function loadMore(): Promise<void> {
    const oldest = timeline[timeline.length - 1]?.date
    if (!oldest) return
    setLoadingMore(true)
    try {
      const more = await window.api.listJournalRange({ before: oldest, limit: TIMELINE_PAGE })
      setTimeline((prev) => [...prev, ...more])
    } catch (err) {
      console.error('listJournalRange(before) failed:', err)
      onStatus?.('加载更早的日志失败', 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  // ---- 保存 / 删除 ----
  async function saveDraft(): Promise<void> {
    if (!draft || savingRef.current) return
    const body = editorRef.current ? editorRef.current.getHTML() : draft.body
    // TipTap 的空段落不算内容
    const isEmpty = body.replace(/<[^>]*>/g, '').trim() === '' && draft.mountedTasks.length === 0
    if (isEmpty) {
      onStatus?.('日志内容为空，没有保存', 'error')
      return
    }
    savingRef.current = true
    try {
      const input: JournalEntryInput = {
        id: draft.id ?? undefined,
        time: draft.time,
        body,
        attachments: draft.attachments,
        mountedTasks: draft.mountedTasks
      }
      const r = await window.api.saveJournalEntry(date, input)
      if (!r.ok) {
        onStatus?.('保存失败：' + (r.error ?? '未知错误'), 'error')
        return
      }
      setDraft(null)
      onStatus?.(draft.id ? '日志已更新' : '日志已保存', 'success')
      if (viewMode === 'day') await loadDay(date)
      else await loadTimeline()
    } catch (err) {
      console.error('saveJournalEntry failed:', err)
      onStatus?.('保存失败', 'error')
    } finally {
      savingRef.current = false
    }
  }

  async function deleteEntry(entry: JournalEntry): Promise<void> {
    if (!window.confirm('确定删除这条日志？此操作不可恢复。')) return
    try {
      const r = await window.api.deleteJournalEntry(date, entry.id)
      if (!r.ok) {
        onStatus?.('删除失败：' + (r.error ?? '未知错误'), 'error')
        return
      }
      onStatus?.('日志已删除', 'success')
      if (viewMode === 'day') await loadDay(date)
      else await loadTimeline()
    } catch (err) {
      console.error('deleteJournalEntry failed:', err)
      onStatus?.('删除失败', 'error')
    }
  }

  // ---- 挂载任务 ----
  async function openTaskPicker(): Promise<void> {
    try {
      setDayTasks(await window.api.readTasks(date))
      setPickOpen(true)
    } catch (err) {
      console.error('readTasks failed:', err)
      onStatus?.('读取当天任务失败', 'error')
    }
  }

  function toggleMount(t: Task): void {
    if (!draft) return
    const exists = draft.mountedTasks.some((m) => m.taskId === t.id)
    setDraft({
      ...draft,
      mountedTasks: exists
        ? draft.mountedTasks.filter((m) => m.taskId !== t.id)
        : // 只存快照：标题 + 完成状态（不抄正文）
          [...draft.mountedTasks, { taskId: t.id, date, title: t.title, done: t.done }]
    })
  }

  /** 点击挂载行 → 先确认任务仍在，再跳转（任务已删除则只提示、保留文字） */
  async function openMounted(m: MountedTask): Promise<void> {
    try {
      const tasks = await window.api.readTasks(m.date)
      if (!tasks.some((t) => t.id === m.taskId)) {
        onStatus?.(`任务「${m.title}」已被删除`, 'error')
        return
      }
      onOpenTask?.(m.date, m.taskId)
    } catch (err) {
      console.error('openMounted failed:', err)
      onStatus?.('跳转失败', 'error')
    }
  }

  // ---- 渲染 ----
  function renderEntry(e: JournalEntry): React.JSX.Element {
    const editing = draft?.id === e.id
    if (editing && draft) return <div key={e.id}>{renderComposer(draft)}</div>
    return (
      <article key={e.id} className="journal-entry">
        <header className="journal-entry-head">
          <span className="journal-entry-time">
            <Clock size={13} /> {e.time || '--:--'}
          </span>
          <span className="journal-entry-spacer" />
          <button
            className="icon-btn"
            title="编辑"
            aria-label="编辑这条日志"
            onClick={() => setDraft(draftFromEntry(e))}
          >
            <PenLine size={15} />
          </button>
          <button
            className="icon-btn danger"
            title="删除"
            aria-label="删除这条日志"
            onClick={() => void deleteEntry(e)}
          >
            <Trash2 size={15} />
          </button>
        </header>

        {e.mountedTasks.length > 0 && (
          <div className="journal-mounted">
            {e.mountedTasks.map((m) => (
              <button
                key={m.taskId}
                className="journal-mounted-item"
                title="跳转到该任务"
                onClick={() => void openMounted(m)}
              >
                <span className={m.done ? 'mounted-done' : 'mounted-todo'}>
                  {m.done ? '☑' : '☐'}
                </span>
                <span className="mounted-title">{m.title}</span>
                <Link2 size={12} />
              </button>
            ))}
          </div>
        )}

        <RichView content={e.body} kind="html" />

        {e.attachments.length > 0 && (
          <div className="journal-attachments">
            {e.attachments.map((a) => (
              <button
                key={a.id}
                className="journal-attach-item"
                onClick={() => void window.api.openAttachment(a.url)}
              >
                📎 {a.name}
              </button>
            ))}
          </div>
        )}
      </article>
    )
  }

  function renderComposer(d: Draft): React.JSX.Element {
    return (
      <section className="journal-composer">
        <div className="journal-composer-head">
          <label className="journal-time-label">
            时间
            <input
              type="time"
              className="journal-time-input"
              value={d.time}
              onChange={(ev) => setDraft({ ...d, time: ev.target.value })}
            />
          </label>
          <span className="journal-entry-spacer" />
          <button className="md-mini-btn" onClick={() => void openTaskPicker()}>
            <Link2 size={14} /> 挂载任务
          </button>
        </div>

        {d.mountedTasks.length > 0 && (
          <div className="journal-mounted">
            {d.mountedTasks.map((m) => (
              <span key={m.taskId} className="journal-mounted-item">
                <span className={m.done ? 'mounted-done' : 'mounted-todo'}>
                  {m.done ? '☑' : '☐'}
                </span>
                <span className="mounted-title">{m.title}</span>
                <button
                  className="icon-btn danger"
                  title="取消挂载"
                  aria-label="取消挂载"
                  onClick={() =>
                    setDraft({ ...d, mountedTasks: d.mountedTasks.filter((x) => x.taskId !== m.taskId) })
                  }
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 用 key 让切换条目时重建编辑器（initialHtml 只在挂载时生效） */}
        <RichTextEditor
          key={d.id ?? 'new'}
          initialHtml={d.body}
          attachFolder={`journal/${date}`}
          attachments={d.attachments}
          onAttachmentsChange={(next) => setDraft({ ...d, attachments: next })}
          editorRef={editorRef}
          onStatus={onStatus}
        />

        <div className="journal-composer-actions">
          <button className="action-btn cancel-btn" onClick={() => setDraft(null)}>
            取消
          </button>
          <button className="action-btn save-btn" onClick={() => void saveDraft()}>
            <Save size={14} /> 保存
          </button>
        </div>
      </section>
    )
  }

  return (
    <div className="journal-view">
      <div className="journal-toolbar">
        <div className="journal-tabs" role="tablist" aria-label="日志浏览方式">
          <button
            role="tab"
            aria-selected={viewMode === 'day'}
            className={viewMode === 'day' ? 'tab-btn active' : 'tab-btn'}
            onClick={() => setViewMode('day')}
          >
            <PenLine size={14} /> 按天
          </button>
          <button
            role="tab"
            aria-selected={viewMode === 'timeline'}
            className={viewMode === 'timeline' ? 'tab-btn active' : 'tab-btn'}
            onClick={() => setViewMode('timeline')}
          >
            <List size={14} /> 时间线
          </button>
        </div>
        <span className="journal-toolbar-spacer" />
        {viewMode === 'day' && (
          <button className="action-btn save-btn" onClick={() => setDraft(emptyDraft())}>
            <Plus size={14} /> 写一条
          </button>
        )}
      </div>

      {loading && <div className="journal-loading">加载中…</div>}

      {viewMode === 'day' ? (
        <>
          {!loading && entries.length === 0 && !draft && (
            <div className="journal-empty">
              <Sparkles size={18} />
              <p>{date} 还没有日志</p>
              <button className="action-btn save-btn" onClick={() => setDraft(emptyDraft())}>
                <Plus size={14} /> 写第一条
              </button>
            </div>
          )}
          {draft && draft.id === null && renderComposer(draft)}
          {entries.map((e) => renderEntry(e))}
        </>
      ) : (
        <>
          {timeline.map((day) => (
            <section key={day.date} className="journal-day-group">
              <h3 className="journal-day-title">{day.date}</h3>
              {day.entries.map((e) => renderEntry(e))}
            </section>
          ))}
          {!loading && timeline.length === 0 && (
            <div className="journal-empty">
              <Sparkles size={18} />
              <p>还没有任何日志</p>
            </div>
          )}
          {timeline.length > 0 && (
            <div className="journal-load-more">
              <button className="md-mini-btn" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? '加载中…' : '加载更早的日志'}
              </button>
            </div>
          )}
        </>
      )}

      {/* 挂载任务选择器 */}
      <Modal open={pickOpen} title={`挂载 ${date} 的任务`} onClose={() => setPickOpen(false)}>
        {dayTasks.length === 0 ? (
          <p className="journal-pick-empty">这一天没有任务</p>
        ) : (
          <div className="journal-pick-list">
            {dayTasks.map((t) => {
              const checked = !!draft?.mountedTasks.some((m) => m.taskId === t.id)
              return (
                <label key={t.id} className="journal-pick-item">
                  <input type="checkbox" checked={checked} onChange={() => toggleMount(t)} />
                  <span className={t.done ? 'mounted-done' : 'mounted-todo'}>{t.done ? '☑' : '☐'}</span>
                  <span className="mounted-title">{t.title || '（无标题）'}</span>
                </label>
              )
            })}
          </div>
        )}
        <div className="journal-composer-actions">
          <button className="action-btn save-btn" onClick={() => setPickOpen(false)}>
            完成
          </button>
        </div>
      </Modal>
    </div>
  )
}
