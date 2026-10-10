import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  BarChart3,
  BookOpenText,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  FileText,
  Megaphone,
  NotebookPen,
  Send,
  Settings,
  StickyNote,
  Tags,
  Trash2,
  Users
} from 'lucide-react'
import Calendar from './components/Calendar'
import SearchBox from './components/SearchBox'
// 内存优化：非默认视图全部懒加载，TipTap / KaTeX 等重库按需进入内存
const StatsView = lazy(() => import('./components/StatsView'))
const TagManager = lazy(() => import('./components/TagManager'))
const TaskPublish = lazy(() => import('./components/TaskPublish/TaskPublishView'))
const TrashView = lazy(() => import('./components/TrashView'))
const ReportView = lazy(() => import('./components/ReportView'))
const WeeklyView = lazy(() => import('./components/WeeklyView'))
const SettingsModal = lazy(() => import('./components/SettingsModal'))
const MeetingList = lazy(() => import('./components/MeetingList'))
const AnnouncementsView = lazy(() => import('./components/AnnouncementsView'))
const StickyNotesView = lazy(() => import('./components/StickyNotesView'))
// 日志页含 TipTap（与会议共用 RichTextEditor），必须懒加载，否则会把富文本库拉进主包
const JournalView = lazy(() => import('./components/JournalView'))
import DayView from './components/DayView'
import UpdateBubble, { type UpdateBubbleState } from './components/UpdateBubble'
import ToastStack, { useToasts } from './components/Toast'
import type { AppSettings, Tag } from './types'
import { toDateStr, weekInfoOf } from './utils/date'

type Mode = 'journal' | 'publish' | 'day' | 'week' | 'stats' | 'report' | 'tags' | 'trash' | 'meeting' | 'announce' | 'sticky'

interface NavItem {
  key: Mode
  label: string
  icon: typeof BarChart3
  group: '日志' | '任务' | '分析' | '管理'
}

// 导航与「日志 / 任务」两个域一一对应：
//   「日志」= 个人手记（时间线式），「任务」= 待办与派发。
// 周报/报表都基于**任务**汇总，因此归在「任务」组，不要放进「日志」组，
// 否则两个域又混在一起了（这正是本次拆分的初衷）。
const NAV_ITEMS: NavItem[] = [
  { key: 'journal', label: '日志', icon: NotebookPen, group: '日志' },
  { key: 'day', label: '任务', icon: CalendarDays, group: '任务' },
  { key: 'week', label: '周报', icon: CalendarRange, group: '任务' },
  { key: 'publish', label: '任务发布', icon: Send, group: '任务' },
  { key: 'stats', label: '统计', icon: BarChart3, group: '分析' },
  { key: 'report', label: '报表', icon: FileText, group: '分析' },
  { key: 'tags', label: '标签', icon: Tags, group: '管理' },
  { key: 'sticky', label: '便签', icon: StickyNote, group: '管理' },
  { key: 'meeting', label: '会议', icon: Users, group: '管理' },
  { key: 'trash', label: '回收站', icon: Trash2, group: '管理' },
  { key: 'announce', label: '更新公告', icon: Megaphone, group: '管理' }
]

const NAV_GROUPS: { name: '日志' | '任务' | '分析' | '管理' }[] = [
  { name: '日志' },
  { name: '任务' },
  { name: '分析' },
  { name: '管理' }
]

export default function App() {
  const [date, setDate] = useState(() => toDateStr(new Date()))
  const [mode, setMode] = useState<Mode>('day')
  /**
   * 日志页的「外部显式跳转」令牌。
   *
   * 日志页**自己管日期**（用户要求：左上角全局日历的点击不要带动日志页）。
   * 只有需要主动跳过去时才用它 —— 目前只有「全局搜索命中一条日志」。
   * 用 nonce 而不是直接传日期，是为了让「同一天再次命中」也能触发跳转，
   * 也避免 App 的其它重渲染把日志页的日期拽回去。
   */
  const [journalJump, setJournalJump] = useState<{ date: string; nonce: number } | undefined>()
  const [weekKey, setWeekKey] = useState(() => weekInfoOf(toDateStr(new Date())).weekKey)
  const [daySel, setDaySel] = useState<{ date: string; taskId: string | null }>({
    date: toDateStr(new Date()),
    taskId: null
  })
  const [settings, setSettings] = useState<AppSettings>({
    theme: 'system',
    accent: 'blue',
    reminder: { enabled: false, time: '18:00' },
    webdav: {
      enabled: false,
      url: '',
      username: '',
      password: '',
      autoMode: 'off',
      intervalMinutes: 30,
      lastSyncAt: null
    },
    updateSource: 'auto'
  })
  const [tags, setTags] = useState<Tag[]>([])
  const [taskDates, setTaskDates] = useState<Set<string>>(new Set())
  // 用户反馈（原底部状态栏的替代）：toasts 收集、notify 作为 onStatus 下发给各视图
  const { toasts, notify, dismiss } = useToasts()
  /**
   * 数据变更版本号。
   *
   * 历史上主区用 `<main key={mode}>` 强制重挂载来保证切页后看到最新数据 ——
   * 代价是丢失全部未持久化草稿（发布页待发布列表、日报行内编辑、周报防抖写入）。
   * 现在改为：任何写操作后自增 dataVersion，各视图把它放进取数 effect 的依赖里，
   * 从而"不重挂载也能刷新自身数据"。
   */
  const [dataVersion, setDataVersion] = useState(0)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [calOpen, setCalOpen] = useState(true)
  // 右下角更新气泡（启动自动检测到新版本后出现）
  const [updateBubble, setUpdateBubble] = useState<UpdateBubbleState | null>(null)
  // 设置弹窗打开期间不弹气泡（设置页内有完整的更新交互），用 ref 供事件回调读取最新值
  const settingsOpenRef = useRef(settingsOpen)
  useEffect(() => {
    settingsOpenRef.current = settingsOpen
  }, [settingsOpen])
  // 左侧功能分组的收起状态（localStorage 持久化）
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem('wl-nav-collapsed')
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
    } catch {
      return {}
    }
  })

  useEffect(() => {
    window.api.listTaskDates().then((ds) => setTaskDates(new Set(ds)))
    window.api.listTags().then(setTags)
    window.api.getSettings().then(setSettings)
    // 每次打开程序自动检测新版本；开发模式下主进程会静默返回（不弹气泡）
    void window.api.checkUpdate()
  }, [])

  // 更新事件 -> 气泡状态机：available 弹气泡，progress/downloaded/error 在气泡内流转
  useEffect(() => {
    const off = window.api.onUpdateEvent(({ channel, payload }) => {
      const p = payload as Record<string, unknown>
      if (channel === 'available') {
        if (settingsOpenRef.current) return
        setUpdateBubble({ kind: 'available', version: String(p.version ?? '') })
      } else if (channel === 'progress') {
        setUpdateBubble((b) => {
          if (!b || b.kind === 'error') return b
          return { kind: 'downloading', version: b.version, percent: Number(p.percent ?? 0) }
        })
      } else if (channel === 'downloaded') {
        setUpdateBubble((b) => {
          if (!b) return b
          const v =
            String(p.version ?? '') ||
            (b.kind === 'available' || b.kind === 'downloading' ? b.version : '')
          return { kind: 'downloaded', version: v }
        })
      } else if (channel === 'not-available' || channel === 'cancelled') {
        setUpdateBubble(null)
      } else if (channel === 'error') {
        setUpdateBubble((b) => {
          if (!b) return b
          const version =
            b.kind === 'available' || b.kind === 'downloading' || b.kind === 'downloaded'
              ? b.version
              : undefined
          return { kind: 'error', version, message: String(p.message ?? '未知错误') }
        })
      }
    })
    return off
  }, [])

  // 数据层告警（文件损坏被隔离 / 写盘失败 / 回收站超限）→ 用户必须看到，不能静默
  useEffect(() => {
    const off = window.api.onDataWarning((w) => {
      notify(
        w.kind === 'corrupt'
          ? `数据文件异常：${w.message}（原文件已备份为 ${w.quarantine ?? '同名 .corrupt 文件'}）`
          : `数据写入失败：${w.message}`,
        'error'
      )
    })
    return off
  }, [notify])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    function apply(): void {
      const isDark = settings.theme === 'dark' || (settings.theme === 'system' && mq.matches)
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
    }
    apply()
    document.documentElement.setAttribute('data-accent', settings.accent)
    // 「跟随系统」需要响应系统主题切换；旧实现只在设置变化时读一次 matchMedia，
    // 系统切深色时应用不会跟随，必须重启或改设置。
    if (settings.theme !== 'system') return
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme, settings.accent])

  // 切换视图时自动展开当前视图所在分组，避免收起状态下找不到当前页
  useEffect(() => {
    const group = NAV_ITEMS.find((n) => n.key === mode)?.group
    if (!group) return
    setCollapsedGroups((prev) => {
      if (!prev[group]) return prev
      const next = { ...prev, [group]: false }
      try {
        localStorage.setItem('wl-nav-collapsed', JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  function toggleGroup(name: string): void {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [name]: !prev[name] }
      try {
        localStorage.setItem('wl-nav-collapsed', JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  // ---- 更新气泡操作 ----
  function handleUpdateDownload(): void {
    void window.api.downloadUpdate()
  }
  function handleUpdateInstall(): void {
    void window.api.installUpdate()
  }
  function handleUpdateCancel(): void {
    void window.api.cancelUpdate()
  }
  function handleUpdateRetry(): void {
    if (updateBubble?.kind !== 'error') return
    const version = updateBubble.version ?? ''
    setUpdateBubble({ kind: 'available', version })
    void window.api.downloadUpdate()
  }

  function refreshTaskDates(): void {
    window.api.listTaskDates().then((ds) => setTaskDates(new Set(ds)))
    // 通知各视图重新拉取自己的数据（替代原先靠重挂载刷新的做法）
    setDataVersion((v) => v + 1)
  }
  function refreshTags(): void {
    window.api.listTags().then(setTags)
    setDataVersion((v) => v + 1)
  }

  function updateSettings(patch: Partial<AppSettings>): void {
    setSettings((prev) => {
      const next: AppSettings = {
        ...prev,
        ...patch,
        reminder: { ...prev.reminder, ...(patch.reminder ?? {}) },
        webdav: { ...prev.webdav, ...(patch.webdav ?? {}) }
      }
      window.api.setSettings(next)
      return next
    })
  }

  function selectDate(d: string): void {
    setDate(d)
    setDaySel({ date: d, taskId: null })
    setMode('day')
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <BookOpenText size={18} strokeWidth={2} />
          </span>
          <span className="brand-name">日志工具</span>
        </div>
        <div className="topbar-right">
          <SearchBox
            onPick={(d, taskId) => {
              setMode('day')
              setDate(d)
              setDaySel({ date: d, taskId })
            }}
            onPickJournal={(d) => {
              // 点中日志命中项 → 切到日志页并跳到那天（走显式跳转令牌，不改全局日期）
              setJournalJump((prev) => ({ date: d, nonce: (prev?.nonce ?? 0) + 1 }))
              setMode('journal')
            }}
          />
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          <div className="sidebar-calendar">
            <button className="sidebar-section-head" onClick={() => setCalOpen((v) => !v)}>
              <span>日历</span>
              <ChevronDown size={14} className={'chev' + (calOpen ? '' : ' flipped')} />
            </button>
            {calOpen && <Calendar selected={date} markers={taskDates} onSelect={selectDate} />}
          </div>

          <nav className="sidebar-nav">
            <h2 className="sidebar-heading">功能</h2>
            {NAV_GROUPS.map((g) => (
              <div className="nav-group" key={g.name}>
                <button
                  type="button"
                  className="sidebar-section-head nav-group-head"
                  onClick={() => toggleGroup(g.name)}
                  aria-expanded={!collapsedGroups[g.name]}
                  title={collapsedGroups[g.name] ? `展开「${g.name}」` : `收起「${g.name}」`}
                >
                  <span>{g.name}</span>
                  <ChevronDown size={14} className={'chev' + (collapsedGroups[g.name] ? '' : ' flipped')} />
                </button>
                {!collapsedGroups[g.name] &&
                  NAV_ITEMS.filter((n) => n.group === g.name).map((n) => {
                    const Icon = n.icon
                    return (
                      <button
                        key={n.key}
                        className={mode === n.key ? 'nav-btn active' : 'nav-btn'}
                        onClick={() => setMode(n.key)}
                        aria-current={mode === n.key ? 'page' : undefined}
                      >
                        <Icon size={17} strokeWidth={2} />
                        <span>{n.label}</span>
                      </button>
                    )
                  })}
              </div>
            ))}
          </nav>

          <div className="sidebar-bottom">
            <button className="nav-btn" onClick={() => setSettingsOpen(true)} title="设置" aria-label="设置">
              <Settings size={17} strokeWidth={2} />
              <span>设置</span>
            </button>
          </div>
        </aside>

        {/* 不再用 key={mode} 强制重挂载：切页应保留各视图的本地草稿，
            数据新鲜度由 dataVersion 驱动各视图自行重新取数 */}
        <main className="main">
          <Suspense fallback={<div style={{ padding: 24, color: 'var(--muted)' }}>加载中…</div>}>
          {mode === 'publish' && (
            <TaskPublish
              tags={tags}
              onStatus={notify}
              onPublished={refreshTaskDates}
              onGoToTags={() => setMode('tags')}
              dataVersion={dataVersion}
            />
          )}

          {mode === 'journal' && (
            <JournalView
              initialDate={date}
              jumpTo={journalJump}
              dataVersion={dataVersion}
              onStatus={notify}
              onOpenTask={(taskDate, taskId) => {
                // 点击日志里关联的任务 → 跳到「任务」页并选中它
                selectDate(taskDate)
                setDaySel({ date: taskDate, taskId })
                setMode('day')
              }}
            />
          )}

          {mode === 'day' && (
            <DayView
              date={date}
              tags={tags}
              selectedTaskId={daySel.date === date ? daySel.taskId : null}
              onSelectTask={(id) => setDaySel({ date, taskId: id })}
              onDateChange={selectDate}
              onTasksChanged={refreshTaskDates}
              onStatus={notify}
              onGoToTags={() => setMode('tags')}
              dataVersion={dataVersion}
            />
          )}

          {mode === 'week' && (
            <WeeklyView
              weekKey={weekKey}
              tags={tags}
              onWeekChange={setWeekKey}
              onStatus={notify}
              dataVersion={dataVersion}
            />
          )}

          {mode === 'stats' && <StatsView date={date} dataVersion={dataVersion} />}

          {mode === 'report' && (
            <ReportView tags={tags} onStatus={notify} />
          )}

          {mode === 'tags' && (
            <TagManager tags={tags} onChanged={refreshTags} onStatus={notify} />
          )}

          {mode === 'trash' && (
            <TrashView onStatus={notify} onRestored={refreshTaskDates} dataVersion={dataVersion} />
          )}

          {mode === 'meeting' && (
            <MeetingList tags={tags} onStatus={notify} />
          )}

          {mode === 'sticky' && (
            <StickyNotesView onStatus={notify} dataVersion={dataVersion} />
          )}

          {mode === 'announce' && <AnnouncementsView />}
          </Suspense>
        </main>
      </div>

      <Suspense fallback={null}>
        <SettingsModal
          open={settingsOpen}
          settings={settings}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
          onStatus={notify}
        />
      </Suspense>

      <ToastStack toasts={toasts} onDismiss={dismiss} />

      <UpdateBubble
        state={updateBubble}
        onDownload={handleUpdateDownload}
        onCancel={handleUpdateCancel}
        onInstall={handleUpdateInstall}
        onRetry={handleUpdateRetry}
        onClose={() => setUpdateBubble(null)}
      />
    </div>
  )
}
