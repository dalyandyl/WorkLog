import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  BarChart3,
  BookOpenText,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  FileText,
  Megaphone,
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
const TaskPublish = lazy(() => import('./components/TaskPublish'))
const TrashView = lazy(() => import('./components/TrashView'))
const ReportView = lazy(() => import('./components/ReportView'))
const WeeklyView = lazy(() => import('./components/WeeklyView'))
const SettingsModal = lazy(() => import('./components/SettingsModal'))
const MeetingList = lazy(() => import('./components/MeetingList'))
const AnnouncementsView = lazy(() => import('./components/AnnouncementsView'))
const StickyNotesView = lazy(() => import('./components/StickyNotesView'))
import DayView from './components/DayView'
import UpdateBubble, { type UpdateBubbleState } from './components/UpdateBubble'
import type { AppSettings, Tag } from './types'
import { toDateStr, weekInfoOf } from './utils/date'

type Mode = 'publish' | 'day' | 'week' | 'stats' | 'report' | 'tags' | 'trash' | 'meeting' | 'announce' | 'sticky'

interface NavItem {
  key: Mode
  label: string
  icon: typeof BarChart3
  group: '日志' | '任务' | '分析' | '管理'
}

const NAV_ITEMS: NavItem[] = [
  { key: 'day', label: '日报', icon: CalendarDays, group: '日志' },
  { key: 'week', label: '周报', icon: CalendarRange, group: '日志' },
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
  const [status, setStatus] = useState('加载中…')

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
      } else if (channel === 'not-available') {
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

  useEffect(() => {
    const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const isDark = settings.theme === 'dark' || (settings.theme === 'system' && sysDark)
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
    document.documentElement.setAttribute('data-accent', settings.accent)
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
  function handleUpdateRetry(): void {
    if (updateBubble?.kind !== 'error') return
    const version = updateBubble.version ?? ''
    setUpdateBubble({ kind: 'available', version })
    void window.api.downloadUpdate()
  }

  function refreshTaskDates(): void {
    window.api.listTaskDates().then((ds) => setTaskDates(new Set(ds)))
  }
  function refreshTags(): void {
    window.api.listTags().then(setTags)
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
          <SearchBox onPick={(d, taskId) => { setMode('day'); setDate(d); setDaySel({ date: d, taskId }) }} />
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
            <button className="nav-btn" onClick={() => setSettingsOpen(true)} title="设置">
              <Settings size={17} strokeWidth={2} />
              <span>设置</span>
            </button>
          </div>
        </aside>

        <main className="main" key={mode}>
          <Suspense fallback={<div style={{ padding: 24, color: 'var(--text-secondary)' }}>加载中…</div>}>
          {mode === 'publish' && (
            <TaskPublish
              tags={tags}
              onStatus={setStatus}
              onPublished={refreshTaskDates}
              onGoToTags={() => setMode('tags')}
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
              onStatus={setStatus}
              onGoToTags={() => setMode('tags')}
            />
          )}

          {mode === 'week' && (
            <WeeklyView
              weekKey={weekKey}
              tags={tags}
              onWeekChange={setWeekKey}
              onStatus={setStatus}
            />
          )}

          {mode === 'stats' && <StatsView date={date} />}

          {mode === 'report' && (
            <ReportView tags={tags} onStatus={setStatus} />
          )}

          {mode === 'tags' && (
            <TagManager tags={tags} onChanged={refreshTags} onStatus={setStatus} />
          )}

          {mode === 'trash' && (
            <TrashView onStatus={setStatus} onRestored={refreshTaskDates} />
          )}

          {mode === 'meeting' && (
            <MeetingList tags={tags} onStatus={setStatus} />
          )}

          {mode === 'sticky' && (
            <StickyNotesView onStatus={setStatus} />
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
          onStatus={setStatus}
        />
      </Suspense>

      <UpdateBubble
        state={updateBubble}
        onDownload={handleUpdateDownload}
        onInstall={handleUpdateInstall}
        onRetry={handleUpdateRetry}
        onClose={() => setUpdateBubble(null)}
      />
    </div>
  )
}
