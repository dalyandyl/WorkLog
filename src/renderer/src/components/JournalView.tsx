import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import {
  CalendarDays,
  Check,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X
} from 'lucide-react'
import type {
  AttachmentMeta,
  JournalDay,
  JournalDaySummary,
  MountedTask,
  StatusReporter,
  Task
} from '../types'
import RichTextEditor from './RichTextEditor'
import RichView from './RichView'
import Modal from './Modal'
import DatePicker from './DatePicker'
import { weekdayOf } from '../utils/date'

interface JournalViewProps {
  /**
   * 进入本页时的初始日期。
   *
   * ⚠️ 之后**由本页自己管理日期**，不再跟随左上角的全局日历 ——
   * 用户明确要求「取消系统左上角日历的点击跳转」。外部需要强行跳转时用 `jumpTo`。
   */
  initialDate: string
  /**
   * 外部显式跳转（例如全局搜索命中一条日志）。
   * 只有 `nonce` 变化时才生效，因此不会被 App 的其它重渲染意外触发。
   */
  jumpTo?: { date: string; nonce: number }
  onStatus?: StatusReporter
  dataVersion?: number
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

/** 正文是否为空（TipTap 的空段落 `<p></p>` 也算空） */
function isBodyEmpty(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === ''
}

/**
 * 日志页面（一天一篇连续文档）。
 *
 * 布局：**左栏**可滚动的「天列表」（只列写过的天，倒序 + 预览，滚到底加载更早）；
 * **右栏**一整张纸。
 *
 * 状态机（2026-10-10 按用户反馈重做）：
 *   - **读态 / 写态分离**：默认是**读态**（渲染后的干净页面），点「编辑」或「写今天」才进入写态。
 *     之前是一直可编辑，用户反馈「一直处于编辑状态」。
 *   - **日期自持**：本页自己管日期，不跟随左上角全局日历。
 *   - **编辑器只在「已加载目标日期」后挂载**：否则切换日期时新编辑器会拿旧一天的内容挂载。
 *   - 写态下**自动保存**（停止输入 700ms），退出写态 / 切日期 / 卸载时都会 flush。
 */
export default function JournalView({
  initialDate,
  jumpTo,
  onStatus,
  dataVersion,
  onOpenTask
}: JournalViewProps): React.JSX.Element {
  const [activeDate, setActiveDate] = useState(initialDate)
  const [mode, setMode] = useState<'read' | 'edit'>('read')

  const [summaries, setSummaries] = useState<JournalDaySummary[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)

  const [day, setDay] = useState<JournalDay | null>(null)
  /** 当前 `day` 真正对应的日期。**只有它与 activeDate 相等时**才允许挂载编辑器。 */
  const [loadedDate, setLoadedDate] = useState('')
  const [docLoading, setDocLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')

  const [pickOpen, setPickOpen] = useState(false)
  const [dayTasks, setDayTasks] = useState<Task[]>([])

  const editorRef = useRef<Editor | null>(null)
  /** 编辑器最新的 HTML（onChange 写入；保存时以它为准） */
  const bodyRef = useRef('')
  /** 是否有未落盘的改动 */
  const dirtyRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  /** 当前已加载文档对应的日期（用于 flush 定位写哪一天） */
  const loadedDateRef = useRef('')
  /**
   * 始终指向**最新一次渲染**的 flush。
   *
   * ⚠️ 不能用 cleanup 里闭包捕获的 `flush`：`useEffect(..., [])` 的清理函数留住的是
   * **首次渲染**的闭包，那时 `day` 还是 null，`flush` 会立刻 return false ——
   * 于是「切走页签时把未保存内容 flush 掉」实际从未生效（静默丢最后几秒的输入）。
   */
  const flushRef = useRef<() => Promise<boolean>>(async () => false)

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

  // ---------- 右栏：加载某一天 ----------
  const loadDay = useCallback(
    async (d: string): Promise<void> => {
      setDocLoading(true)
      // 先把 loadedDate 清掉：这样在读取期间**不会**挂载编辑器，
      // 避免「新日期的编辑器用旧一天的内容挂载」。
      setLoadedDate('')
      loadedDateRef.current = ''
      try {
        const data = await window.api.readJournalDay(d)
        loadedDateRef.current = d
        setLoadedDate(d)
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
    void loadDay(activeDate)
  }, [activeDate, dataVersion, loadDay])

  // 外部显式跳转（搜索命中）：只在 nonce 变化时跟随
  const lastJumpNonce = useRef<number>(-1)
  useEffect(() => {
    if (!jumpTo) return
    if (jumpTo.nonce === lastJumpNonce.current) return
    lastJumpNonce.current = jumpTo.nonce
    setActiveDate(jumpTo.date)
    setMode('read')
  }, [jumpTo])

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
  flushRef.current = flush

  /** 排一次防抖保存 */
  const scheduleSave = useCallback((): void => {
    dirtyRef.current = true
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      void flushRef.current().then((wrote) => {
        // 保存后刷新左栏预览（新的一天会因此出现在列表里）
        if (wrote) void loadSummaries()
      })
    }, AUTOSAVE_MS)
  }, [loadSummaries])

  /** 立刻保存（并刷新左栏列表） */
  const flushNow = useCallback(async (): Promise<boolean> => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    const wrote = await flushRef.current()
    if (wrote) await loadSummaries()
    return wrote
  }, [loadSummaries])

  // 卸载（视图是条件渲染，切页签会被卸载）时把未落盘的改动写掉。
  // 用 flushRef 取最新实现 —— 见其声明处的说明。
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      void flushRef.current()
    }
  }, [])

  // ---------- 内容与关联 ----------
  function onBodyChange(html: string): void {
    bodyRef.current = html
    scheduleSave()
  }

  function patchDay(patch: Partial<JournalDay>): void {
    setDay((prev) => (prev ? { ...prev, ...patch } : prev))
    scheduleSave()
  }

  /** 切到某一天：先保存当前写态的内容，再回到读态 */
  async function selectDate(d: string): Promise<void> {
    if (d === activeDate) {
      // 同一天再点：若在写态就退出写态，否则进入写态（让点击总有反馈）
      if (mode === 'edit') await exitEdit()
      else setMode('edit')
      return
    }
    if (mode === 'edit') await flushNow()
    setMode('read')
    setActiveDate(d)
  }

  async function enterEdit(): Promise<void> {
    // 只有在目标日期确实加载完成后才允许进入写态
    if (loadedDate !== activeDate) return
    setMode('edit')
  }

  async function exitEdit(): Promise<void> {
    await flushNow()
    setMode('read')
  }

  /** 「写今天」：跳到今天并直接进入写态（原来这里的 + 因为 `d === date` 会 early-return，点了没反应） */
  async function writeToday(): Promise<void> {
    const today = toDateStr(new Date())
    if (today !== activeDate) {
      if (mode === 'edit') await flushNow()
      setActiveDate(today)
    }
    setMode('edit')
  }

  async function openTaskPicker(): Promise<void> {
    try {
      setDayTasks(await window.api.readTasks(activeDate))
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
        [...day.mountedTasks, { taskId: t.id, date: activeDate, title: t.title, done: t.done }]
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
    if (!window.confirm(`确定删除 ${formatDayLabel(activeDate)} 的日志？会先移入回收站，可以恢复。`))
      return
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    dirtyRef.current = false
    try {
      const r = await window.api.deleteJournalDay(activeDate)
      if (!r.ok) {
        onStatus?.('删除失败：' + (r.error ?? '未知错误'), 'error')
        return
      }
      onStatus?.('日志已移入回收站', 'success')
      setMode('read')
      await loadDay(activeDate)
      await loadSummaries()
    } catch (err) {
      console.error('deleteJournalDay failed:', err)
      onStatus?.('删除失败', 'error')
    }
  }

  const body = day?.body ?? ''
  const isEmptyDoc = isBodyEmpty(body) && (day?.attachments.length ?? 0) === 0
  /** 编辑器只有在「写态」且「已加载的正是当前日期」时才挂载 */
  const canEdit = mode === 'edit' && loadedDate === activeDate && !!day

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
            onClick={() => void writeToday()}
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="journal-days-list">
          {listLoading && <div className="journal-days-hint">加载中…</div>}
          {!listLoading && summaries.length === 0 && (
            <div className="journal-days-hint">还没有日志。点顶部「选择日期」或右上「写今天」开始写。</div>
          )}
          {summaries.map((s) => (
            <button
              key={s.date}
              className={s.date === activeDate ? 'journal-day active' : 'journal-day'}
              aria-current={s.date === activeDate ? 'true' : undefined}
              onClick={() => void selectDate(s.date)}
            >
              <span className="journal-day-date">
                {formatDayLabel(s.date)}
                {s.mountedCount > 0 && <Link2 size={11} className="journal-day-link" />}
              </span>
              <span className="journal-day-preview">{s.preview || '（空白）'}</span>
            </button>
          ))}
          {summaries.length > 0 && !exhausted && (
            <button
              className="journal-day-more"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
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
              <h2>{formatDayLabel(activeDate)}</h2>
              <span className="journal-doc-status">
                {mode === 'read' ? (
                  isEmptyDoc ? (
                    '还没有内容'
                  ) : (
                    <>
                      <Check size={12} /> 已保存
                    </>
                  )
                ) : saving ? (
                  <>
                    <Loader2 size={12} className="spin" /> 保存中…
                  </>
                ) : savedAt ? (
                  <>
                    <Check size={12} /> 已自动保存
                  </>
                ) : (
                  '编辑中'
                )}
              </span>
            </div>

            <div className="journal-doc-actions">
              {/* 手动选择任意日期（含没有日志的日期，可以直接开始写） */}
              <DatePicker
                value={activeDate}
                onChange={(d) => void selectDate(d)}
                title="选择要写/查看的日期"
                label="选择日期"
                portal
              />
              <button className="md-mini-btn" onClick={() => void openTaskPicker()} disabled={!day}>
                <Link2 size={14} /> 关联任务
              </button>
              {mode === 'read' ? (
                <button
                  className="action-btn save-btn"
                  onClick={() => void enterEdit()}
                  disabled={!day || loadedDate !== activeDate}
                >
                  <Pencil size={14} /> {isEmptyDoc ? '开始写' : '编辑'}
                </button>
              ) : (
                <button className="action-btn save-btn" onClick={() => void exitEdit()}>
                  <Check size={14} /> 完成
                </button>
              )}
              {mode === 'read' && !isEmptyDoc && (
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

          {/* 未写过的日期给个明确提示 */}
          {!docLoading && day && isEmptyDoc && mode === 'read' && (
            <div className="journal-blank">
              <CalendarDays size={20} />
              <p>{formatDayLabel(activeDate)} 还没有日志</p>
              <button className="action-btn save-btn" onClick={() => void enterEdit()}>
                <Pencil size={14} /> 写这一天
              </button>
            </div>
          )}

          {/* 关联任务（快照胶囊行） */}
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
                  {mode === 'edit' && (
                    <button
                      className="icon-btn danger"
                      title="取消关联"
                      aria-label="取消关联"
                      onClick={() =>
                        patchDay({
                          mountedTasks: day.mountedTasks.filter((x) => x.taskId !== m.taskId)
                        })
                      }
                    >
                      <X size={13} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          {docLoading && <div className="journal-doc-loading">加载中…</div>}

          {/* 读态：渲染后的干净页面 */}
          {!docLoading && day && !isEmptyDoc && mode === 'read' && (
            <>
              <RichView content={body} kind="html" />
              {day.attachments.length > 0 && (
                <div className="journal-attachments">
                  {day.attachments.map((a) => (
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
            </>
          )}

          {/* 写态：编辑器（key 用日期，切天即重建） */}
          {canEdit && (
            <RichTextEditor
              key={activeDate}
              initialHtml={day.body}
              attachFolder={`journal/${activeDate}`}
              attachments={day.attachments}
              onAttachmentsChange={(next: AttachmentMeta[]) => patchDay({ attachments: next })}
              onChange={onBodyChange}
              editorRef={editorRef}
              onStatus={onStatus}
            />
          )}
        </div>
      </main>

      {/* 关联任务选择器 */}
      <Modal
        open={pickOpen}
        title={`关联 ${formatDayLabel(activeDate)} 的任务`}
        onClose={() => setPickOpen(false)}
      >
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
