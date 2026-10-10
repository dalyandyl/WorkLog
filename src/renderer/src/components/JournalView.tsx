import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { Check, Link2, Loader2, Plus, Trash2, X } from 'lucide-react'
import type {
  AttachmentMeta,
  JournalDay,
  JournalDaySummary,
  MountedTask,
  StatusReporter,
  Task
} from '../types'
import RichTextEditor from './RichTextEditor'
import Modal from './Modal'
import { weekdayOf } from '../utils/date'

interface JournalViewProps {
  /** 当前选中的日期（与左侧日历 / 搜索跳转联动） */
  date: string
  onStatus?: StatusReporter
  dataVersion?: number
  /** 切换日期时通知外层（日历、其他页跟着走） */
  onDateChange?: (date: string) => void
  /** 点击「关联任务」跳转到该任务 */
  onOpenTask?: (date: string, taskId: string) => void
}

/** 左栏一页取多少天 */
const PAGE = 30
/** 停止输入多久后落盘（Word/备忘录那种「不用点保存」的观感） */
const AUTOSAVE_MS = 700

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** `2026-10-10` → `10月10日 周五`（当年不显示年份，避免列表噪音） */
function formatDayLabel(date: string): string {
  const [y, m, d] = date.split('-')
  const thisYear = String(new Date().getFullYear())
  const md = `${Number(m)}月${Number(d)}日`
  return y === thisYear ? `${md} ${weekdayOf(date)}` : `${y}年${md}`
}

/**
 * 日志页面（一天一篇连续文档）。
 *
 * 布局仿照 Word / 备忘录这类写作工具：
 *   - **左栏**：可滚动的「天列表」，只列写过的天，倒序 + 内容预览，滚到底加载更早；
 *   - **右栏**：一整张纸，居中定宽，内容一直往下写，**不需要点保存**（停止输入后自动落盘）。
 *
 * 与任务模块相互独立：这里只读取任务快照用于「关联任务」，从不修改任务数据。
 */
export default function JournalView({
  date,
  onStatus,
  dataVersion,
  onDateChange,
  onOpenTask
}: JournalViewProps): React.JSX.Element {
  const [summaries, setSummaries] = useState<JournalDaySummary[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)

  const [day, setDay] = useState<JournalDay | null>(null)
  const [docLoading, setDocLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string>('')

  const [pickOpen, setPickOpen] = useState(false)
  const [dayTasks, setDayTasks] = useState<Task[]>([])

  const editorRef = useRef<Editor | null>(null)
  /** 编辑器最新的 HTML（onChange 写入；保存时以它为准） */
  const bodyRef = useRef('')
  /** 是否有未落盘的改动 */
  const dirtyRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  /** 已加载文档对应的日期，防止异步竞态把 A 天的内容写到 B 天 */
  const loadedDateRef = useRef<string>('')

  // ---------- 左栏：天列表 ----------
  const loadSummaries = useCallback(
    async (opts: { before?: string; append?: boolean } = {}): Promise<void> => {
      if (opts.append) setLoadingMore(true)
      else setListLoading(true)
      try {
        const list = await window.api.listJournalSummaries({ before: opts.before, limit: PAGE })
        setSummaries((prev) => (opts.append ? [...prev, ...list] : list))
        setExhausted(list.length < PAGE)
      } catch (err) {
        console.error('listJournalSummaries failed:', err)
        onStatus?.('读取日志列表失败', 'error')
      } finally {
        setListLoading(false)
        setLoadingMore(false)
      }
    },
    [onStatus]
  )

  useEffect(() => {
    void loadSummaries()
  }, [loadSummaries, dataVersion])

  async function loadMore(): Promise<void> {
    const oldest = summaries[summaries.length - 1]?.date
    if (!oldest || loadingMore) return
    await loadSummaries({ before: oldest, append: true })
  }

  // ---------- 右栏：当天文档 ----------
  const loadDay = useCallback(
    async (d: string): Promise<void> => {
      setDocLoading(true)
      try {
        const data = await window.api.readJournalDay(d)
        loadedDateRef.current = d
        bodyRef.current = data?.body ?? ''
        dirtyRef.current = false
        setSavedAt(data?.updatedAt ?? '')
        setDay(
          data ?? {
            date: d,
            body: '',
            attachments: [],
            mountedTasks: [],
            createdAt: '',
            updatedAt: ''
          }
        )
      } catch (err) {
        console.error('readJournalDay failed:', err)
        onStatus?.('读取日志失败', 'error')
        setDay(null)
      } finally {
        setDocLoading(false)
      }
    },
    [onStatus]
  )

  useEffect(() => {
    void loadDay(date)
  }, [date, dataVersion, loadDay])

  // ---------- 自动保存 ----------
  /** 把当前内容写盘。返回是否真的写了。 */
  const flush = useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return false
    const target = loadedDateRef.current
    if (!target || !day) return false
    dirtyRef.current = false
    setSaving(true)
    try {
      const body = editorRef.current ? editorRef.current.getHTML() : bodyRef.current
      const r = await window.api.saveJournalDay(target, {
        body,
        attachments: day.attachments,
        mountedTasks: day.mountedTasks
      })
      if (!r.ok) {
        dirtyRef.current = true
        onStatus?.('保存失败：' + (r.error ?? '未知错误'), 'error')
        return false
      }
      if (r.day) setSavedAt(r.day.updatedAt)
      return true
    } catch (err) {
      console.error('saveJournalDay failed:', err)
      dirtyRef.current = true
      onStatus?.('保存失败', 'error')
      return false
    } finally {
      setSaving(false)
    }
  }, [day, onStatus])

  /** 排一次防抖保存 */
  const scheduleSave = useCallback((): void => {
    dirtyRef.current = true
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void flush().then((wrote) => {
        // 保存后刷新左栏预览（新的一天会因此出现在列表里）
        if (wrote) void loadSummaries()
      })
    }, AUTOSAVE_MS)
  }, [flush, loadSummaries])

  // 卸载 / 切页时把未落盘的改动 flush 掉（视图是条件渲染，会被卸载）
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      // 这里不能 await；flush 内部自身是幂等且带错误处理的
      void flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 切换日期前先保存上一天，避免内容写到错误的日期
  useEffect(() => {
    return () => {
      if (dirtyRef.current) void flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  // ---------- 内容与挂载 ----------
  function onBodyChange(html: string): void {
    bodyRef.current = html
    scheduleSave()
  }

  function patchDay(patch: Partial<JournalDay>): void {
    setDay((prev) => (prev ? { ...prev, ...patch } : prev))
    scheduleSave()
  }

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
    if (!day) return
    const exists = day.mountedTasks.some((m) => m.taskId === t.id)
    const next: MountedTask[] = exists
      ? day.mountedTasks.filter((m) => m.taskId !== t.id)
      : // 只存快照：标题 + 完成状态（不抄正文）
        [...day.mountedTasks, { taskId: t.id, date, title: t.title, done: t.done }]
    patchDay({ mountedTasks: next })
  }

  /** 点击关联任务 → 先确认任务仍在，再跳转（任务已删则只提示、文字保留） */
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

  async function deleteDay(): Promise<void> {
    if (!window.confirm(`确定删除 ${formatDayLabel(date)} 的日志？会先移入回收站，可以恢复。`)) return
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    dirtyRef.current = false
    try {
      const r = await window.api.deleteJournalDay(date)
      if (!r.ok) {
        onStatus?.('删除失败：' + (r.error ?? '未知错误'), 'error')
        return
      }
      onStatus?.('日志已移入回收站', 'success')
      await loadDay(date)
      await loadSummaries()
    } catch (err) {
      console.error('deleteJournalDay failed:', err)
      onStatus?.('删除失败', 'error')
    }
  }

  async function saveNow(): Promise<void> {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    const wrote = await flush()
    if (wrote) {
      await loadSummaries()
      onStatus?.('已保存', 'success')
    }
  }

  function pickDate(d: string): void {
    if (d === date) return
    onDateChange?.(d)
  }

  const today = toDateStr(new Date())
  const isEmptyDoc = !!day && day.body.replace(/<[^>]*>/g, '').trim() === '' && day.attachments.length === 0

  return (
    <div className="journal-view">
      {/* ---------------- 左栏：天列表 ---------------- */}
      <aside className="journal-days" aria-label="日志日期列表">
        <div className="journal-days-head">
          <span className="journal-days-title">日志</span>
          <button
            className="icon-btn"
            title="写今天"
            aria-label="写今天"
            onClick={() => pickDate(today)}
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="journal-days-list">
          {listLoading && <div className="journal-days-hint">加载中…</div>}
          {!listLoading && summaries.length === 0 && (
            <div className="journal-days-hint">还没有日志，直接在右侧开始写吧</div>
          )}
          {summaries.map((s) => (
            <button
              key={s.date}
              className={s.date === date ? 'journal-day active' : 'journal-day'}
              aria-current={s.date === date ? 'true' : undefined}
              onClick={() => pickDate(s.date)}
            >
              <span className="journal-day-date">
                {formatDayLabel(s.date)}
                {s.mountedCount > 0 && <Link2 size={11} className="journal-day-link" />}
              </span>
              <span className="journal-day-preview">{s.preview || '（空白）'}</span>
            </button>
          ))}
          {summaries.length > 0 && !exhausted && (
            <button className="journal-day-more" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? '加载中…' : '加载更早'}
            </button>
          )}
        </div>
      </aside>

      {/* ---------------- 右栏：当天文档 ---------------- */}
      <main className="journal-doc">
        <div className="journal-doc-inner">
          <header className="journal-doc-head">
            <div className="journal-doc-title">
              <h2>{formatDayLabel(date)}</h2>
              <span className="journal-doc-status">
                {saving ? (
                  <>
                    <Loader2 size={12} className="spin" /> 保存中…
                  </>
                ) : savedAt ? (
                  <>
                    <Check size={12} /> 已自动保存
                  </>
                ) : (
                  '未保存'
                )}
              </span>
            </div>
            <div className="journal-doc-actions">
              <button className="md-mini-btn" onClick={() => void openTaskPicker()}>
                <Link2 size={14} /> 关联任务
              </button>
              <button className="md-mini-btn" onClick={() => void saveNow()}>
                保存
              </button>
              {!isEmptyDoc && (
                <button
                  className="icon-btn danger"
                  title="删除这天的日志"
                  aria-label="删除这天的日志"
                  onClick={() => void deleteDay()}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </header>

          {/* 关联任务（快照行，不影响正文的连贯性） */}
          {day && day.mountedTasks.length > 0 && (
            <div className="journal-mounted">
              {day.mountedTasks.map((m) => (
                <span key={m.taskId} className="journal-mounted-item">
                  <button className="mounted-jump" onClick={() => void openMounted(m)}>
                    <span className={m.done ? 'mounted-done' : 'mounted-todo'}>
                      {m.done ? '☑' : '☐'}
                    </span>
                    <span className="mounted-title">{m.title}</span>
                  </button>
                  <button
                    className="icon-btn danger"
                    title="取消关联"
                    aria-label="取消关联"
                    onClick={() =>
                      patchDay({ mountedTasks: day.mountedTasks.filter((x) => x.taskId !== m.taskId) })
                    }
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {docLoading && <div className="journal-doc-loading">加载中…</div>}

          {!docLoading && day && (
            <>
              {/* key 用日期：切换哪一天就重建编辑器（initialHtml 只在挂载时生效） */}
              <RichTextEditor
                key={date}
                initialHtml={day.body}
                attachFolder={`journal/${date}`}
                attachments={day.attachments}
                onAttachmentsChange={(next: AttachmentMeta[]) => patchDay({ attachments: next })}
                onChange={onBodyChange}
                editorRef={editorRef}
                onStatus={onStatus}
              />
            </>
          )}
        </div>
      </main>

      {/* 挂载任务选择器 */}
      <Modal open={pickOpen} title={`关联 ${formatDayLabel(date)} 的任务`} onClose={() => setPickOpen(false)}>
        {dayTasks.length === 0 ? (
          <p className="journal-pick-empty">这一天没有任务</p>
        ) : (
          <div className="journal-pick-list">
            {dayTasks.map((t) => {
              const checked = !!day?.mountedTasks.some((m) => m.taskId === t.id)
              return (
                <label key={t.id} className="journal-pick-item">
                  <input type="checkbox" checked={checked} onChange={() => toggleMount(t)} />
                  <span className={t.done ? 'mounted-done' : 'mounted-todo'}>
                    {t.done ? '☑' : '☐'}
                  </span>
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
