import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  BookOpenText,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Check,
  ClipboardList,
  FileText,
  Megaphone,
  Minus,
  NotebookPen,
  Send,
  Settings,
  Square,
  StickyNote,
  Tags,
  MoreHorizontal,
  ChevronDown,
  Trash2,
  Users,
  X
} from 'lucide-react'
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
const CalendarView = lazy(() => import('./components/CalendarView'))
const TimelineView = lazy(() => import('./components/TimelineView'))
const MomProView = lazy(() => import('./components/MomProView'))
import DayView from './components/DayView'
import UpdateBubble, { type UpdateBubbleState } from './components/UpdateBubble'
import type { AppSettings, Tag, Task } from './types'
import { toDateStr, weekInfoOf } from './utils/date'

type Mode =
  | 'publish'
  | 'day'
  | 'week'
  | 'calendar'
  | 'timeline'
  | 'mompro'
  | 'stats'
  | 'report'
  | 'tags'
  | 'trash'
  | 'meeting'
  | 'announce'
  | 'sticky'

interface NavItem {
  key: Mode
  label: string
  icon: typeof BarChart3
  /** 图标轨里的分组分隔：true = 在这一项之前画一条淡分隔线 */
  sep?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { key: 'day', label: '日报', icon: NotebookPen },
  { key: 'week', label: '周报', icon: CalendarRange },
  { key: 'calendar', label: '日历', icon: CalendarDays },
  { key: 'timeline', label: '时间线', icon: CalendarClock },
  { key: 'publish', label: '任务发布', icon: Send, sep: true },
  { key: 'stats', label: '统计', icon: BarChart3, sep: true },
  { key: 'report', label: '报表', icon: FileText },
  { key: 'sticky', label: '便签', icon: StickyNote, sep: true },
  { key: 'mompro', label: '功能台账', icon: ClipboardList },
  { key: 'meeting', label: '会议', icon: Users },
  { key: 'tags', label: '标签', icon: Tags },
  { key: 'trash', label: '回收站', icon: Trash2, sep: true },
  { key: 'announce', label: '更新公告', icon: Megaphone }
]

/** 按窗口宽度决定露几个页签：全屏时全露，默认窗口下把多的收进「更多」 */
function visibleTabCount(width: number, total: number): number {
  const narrow = width < 1120
  const tabWidth = narrow ? 46 : 78
  const reserved = narrow ? 320 : 480
  return Math.max(6, Math.min(total, Math.floor((width - reserved) / tabWidth)))
}

const MODE_TITLE: Record<Mode, string> = {
  day: '日报',
  week: '周报',
  calendar: '日历',
  timeline: '时间线',
  mompro: '功能台账',
  publish: '任务发布',
  stats: '统计',
  report: '报表',
  sticky: '便签',
  meeting: '会议纪要',
  tags: '标签',
  trash: '回收站',
  announce: '更新公告'
}

/** 上下文栏的固定说明文案（各页面重建时再替换成真正的筛选/列表） */
const MODE_HINT: Partial<Record<Mode, string>> = {
  calendar: '点选任意日期查看当天任务；带圆点的日期表示当天有记录。',
  timeline: '按日志日期倒序列出所有任务；滚动右侧内容会自动定位左侧，点左侧条目可直接跳转。',
  publish: '一次发布会把同一份任务写进所选区间的每一天；改任意一天都会同步全部副本。',
  stats: '统计按「周/月/季/年」汇总任务量与日报字数，休息日可单独排除。',
  report: '报表把日报汇总成周报/月报，可导出 Markdown 或 Word。',
  sticky: '便签独立于日期，可置顶；置顶的便签会显示在日报页顶部。',
  mompro: '记录 MomPro 里的表单/事务：叫什么、在哪个插件、怎么跑、动了哪些表。',
  meeting: '会议纪要支持富文本、截图与待办提取。',
  tags: '标签是全局的，改名/改色会同步到所有引用处。',
  trash: '回收站保留 30 天；删除任务会连带删除区间内所有副本。',
  announce: '这里能看到每个版本的更新内容。'
}

export default function App() {
  const [date, setDate] = useState(() => toDateStr(new Date()))
  const [mode, setMode] = useState<Mode>('day')
  const [weekKey, setWeekKey] = useState(() => weekInfoOf(toDateStr(new Date())).weekKey)
  const [daySel, setDaySel] = useState<{ date: string; taskId: string | null }>({
    date: toDateStr(new Date()),
    taskId: null
  })
  const [settings, setSettings] = useState<AppSettings>({
    theme: 'aurora',
    accent: 'blue',
    glass: 'normal',
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
    updateSource: 'auto',
    momproAccess: false
  })
  const [tags, setTags] = useState<Tag[]>([])
  const [taskDates, setTaskDates] = useState<Set<string>>(new Set())
  /** 操作结果提示：用户要求不弹提示条，state 保留只为兼容各处 onStatus 回调 */
  const [, setStatus] = useState('')
  /** 外部（上下文栏）改动任务后，用它通知日报页重新加载 */
  const [tasksRev, setTasksRev] = useState(0)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [maximized, setMaximized] = useState(false)
  // 「更多」菜单：放不下的页签收进这里
  const [moreOpen, setMoreOpen] = useState(false)
  // 功能台账是个人专用模块：未输入密匙解锁前不进导航（密匙在设置 → 权限认证里录入）
  const navItems = useMemo(
    () => NAV_ITEMS.filter((n) => n.key !== 'mompro' || settings.momproAccess),
    [settings.momproAccess]
  )
  // 页签显示数量跟着窗口宽度走（全屏时全部露出，默认窗口下多的进「更多」）
  const [tabCount, setTabCount] = useState(() => visibleTabCount(window.innerWidth, navItems.length))
  const overflowItems = navItems.slice(tabCount)
  useEffect(() => {
    const onResize = (): void => setTabCount(visibleTabCount(window.innerWidth, navItems.length))
    // 解锁 / 锁定会改变页签总数，这里同步重算一次
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [navItems.length])
  // 锁定状态下不允许停在功能台账页（例如在设置里点了「锁定」）
  useEffect(() => {
    if (mode === 'mompro' && !settings.momproAccess) setMode('day')
  }, [mode, settings.momproAccess])
  const moreRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!moreOpen) return
    const onDown = (e: MouseEvent): void => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [moreOpen])
  // 右下角更新气泡（启动自动检测到新版本后出现）
  const [updateBubble, setUpdateBubble] = useState<UpdateBubbleState | null>(null)
  // 设置弹窗打开期间不弹气泡（设置页内有完整的更新交互），用 ref 供事件回调读取最新值
  const settingsOpenRef = useRef(settingsOpen)
  useEffect(() => {
    settingsOpenRef.current = settingsOpen
  }, [settingsOpen])

  useEffect(() => {
    window.api.listTaskDates().then((ds) => setTaskDates(new Set(ds)))
    window.api.listTags().then(setTags)
    window.api.getSettings().then(setSettings)
    // 每次打开程序自动检测新版本；开发模式下主进程会静默返回（不弹气泡）
    void window.api.checkUpdate()
    void window.api.isWindowMaximized().then(setMaximized)
    return window.api.onWindowMaximized(setMaximized)
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
    document.documentElement.setAttribute('data-theme', settings.theme)
    document.documentElement.setAttribute('data-accent', settings.accent)
    document.documentElement.setAttribute('data-glass', settings.glass)
  }, [settings.theme, settings.accent, settings.glass])

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

  /** 上下文栏里直接勾选当天任务（与日报页共用同一条 updateTask 同步路径） */


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

  const weekInfo = weekInfoOf(date)

  return (
    <div className="app">
      <div className="aurora-layer" aria-hidden="true" />
      <div className="grain-layer" aria-hidden="true" />

      {/* 自绘标题栏（frameless 窗口没有原生按钮） */}
      <header className="titlebar">
        <div className="tb-brand">
          <span className="tb-mark">
            <BookOpenText size={13} strokeWidth={2.2} />
          </span>
          <span className="tb-name">日志工具</span>
          <span className="tb-ver">1.5.5-beta1</span>
        </div>

        <div className="tb-center" />

        <div className="tb-actions">
          <button
            className="icon-btn"
            title="设置"
            aria-label="设置"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={15} />
          </button>
          <div className="winbtns">
            <button
              className="winbtn"
              title="最小化"
              aria-label="最小化"
              onClick={() => void window.api.winMinimize()}
            >
              <Minus size={14} />
            </button>
            <button
              className="winbtn"
              title={maximized ? '还原' : '最大化'}
              aria-label={maximized ? '还原' : '最大化'}
              onClick={() => void window.api.winToggleMaximize().then(setMaximized)}
            >
              <Square size={11} />
            </button>
            <button
              className="winbtn close"
              title="关闭"
              aria-label="关闭"
              onClick={() => void window.api.winClose()}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* 顶部导航：页签最多 10 个，其余进「更多」；搜索框与页签同排 */}
      <nav className="topnav">
        {navItems.slice(0, tabCount).map((n) => {
          const Icon = n.icon
          return (
            <span key={n.key} style={{ display: 'contents' }}>
              {n.sep && <i className="navsep" aria-hidden="true" />}
              <button
                className={'navtab' + (mode === n.key ? ' on' : '')}
                title={n.label}
                aria-current={mode === n.key ? 'page' : undefined}
                onClick={() => setMode(n.key)}
              >
                <Icon size={15} strokeWidth={1.9} />
                <span>{n.label}</span>
              </button>
            </span>
          )
        })}

        {overflowItems.length > 0 && (
          <div className="nav-more" ref={moreRef}>
            <button
              className={
                'navtab navmore-btn' +
                (moreOpen || overflowItems.some((n) => n.key === mode) ? ' on' : '')
              }
              title="更多"
              onClick={() => setMoreOpen((v) => !v)}
            >
              <MoreHorizontal size={15} strokeWidth={1.9} />
              <span>更多</span>
              <ChevronDown size={12} className="navmore-caret" />
            </button>
            {moreOpen && (
              <div className="navmenu" role="menu">
                {overflowItems.map((n) => {
                  const Icon = n.icon
                  return (
                    <button
                      key={n.key}
                      className={'navmenu-item' + (mode === n.key ? ' on' : '')}
                      role="menuitem"
                      onClick={() => {
                        setMode(n.key)
                        setMoreOpen(false)
                      }}
                    >
                      <Icon size={15} strokeWidth={1.9} />
                      <span>{n.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <div className="nav-search">
          <SearchBox
            onPick={(d, taskId) => {
              setMode('day')
              setDate(d)
              setDaySel({ date: d, taskId })
            }}
          />
        </div>
      </nav>

      <div className="shell">        {/* 工作区 */}
        <div className="work">
          <main className="main" key={mode}>
            <Suspense
              fallback={<div style={{ padding: 24, color: 'var(--text-secondary)' }}>加载中…</div>}
            >
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
                  reloadKey={tasksRev}
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

              {mode === 'calendar' && (
                <CalendarView
                  date={date}
                  taskDates={taskDates}
                  onPick={(d) => {
                    setDate(d)
                    setDaySel({ date: d, taskId: null })
                  }}
                  onOpenDay={(d) => {
                    selectDate(d)
                  }}
                />
              )}

              {mode === 'timeline' && <TimelineView />}
              {mode === 'mompro' && settings.momproAccess && <MomProView />}

              {mode === 'stats' && <StatsView date={date} />}

              {mode === 'report' && <ReportView tags={tags} onStatus={setStatus} />}

              {mode === 'tags' && (
                <TagManager tags={tags} onChanged={refreshTags} onStatus={setStatus} />
              )}

              {mode === 'trash' && <TrashView onStatus={setStatus} onRestored={refreshTaskDates} />}

              {mode === 'meeting' && <MeetingList tags={tags} onStatus={setStatus} />}

              {mode === 'sticky' && <StickyNotesView onStatus={setStatus} />}

              {mode === 'announce' && <AnnouncementsView />}
            </Suspense>
          </main>
        </div>
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
