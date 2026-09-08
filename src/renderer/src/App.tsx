import { useEffect, useState } from 'react'
import {
  BarChart3,
  BookOpenText,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  FileText,
  Send,
  Settings,
  Tags,
  Trash2,
  Users
} from 'lucide-react'
import Calendar from './components/Calendar'
import SearchBox from './components/SearchBox'
import StatsView from './components/StatsView'
import TagManager from './components/TagManager'
import TaskPublish from './components/TaskPublish'
import TrashView from './components/TrashView'
import ReportView from './components/ReportView'
import DayView from './components/DayView'
import WeeklyView from './components/WeeklyView'
import SettingsModal from './components/SettingsModal'
import MeetingList from './components/MeetingList'
import type { AppSettings, Tag } from './types'
import { toDateStr, weekInfoOf } from './utils/date'

type Mode = 'publish' | 'day' | 'week' | 'stats' | 'report' | 'tags' | 'trash' | 'meeting'

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
  { key: 'meeting', label: '会议', icon: Users, group: '管理' },
  { key: 'trash', label: '回收站', icon: Trash2, group: '管理' }
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
  const [storageRoot, setStorageRoot] = useState('')
  const [status, setStatus] = useState('加载中…')

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [calOpen, setCalOpen] = useState(true)

  useEffect(() => {
    window.api.getStorageRoot().then(setStorageRoot)
    window.api.listTaskDates().then((ds) => setTaskDates(new Set(ds)))
    window.api.listTags().then(setTags)
    window.api.getSettings().then(setSettings)
  }, [])

  useEffect(() => {
    const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const isDark = settings.theme === 'dark' || (settings.theme === 'system' && sysDark)
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
    document.documentElement.setAttribute('data-accent', settings.accent)
  }, [settings.theme, settings.accent])

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
                <div className="nav-group-label">{g.name}</div>
                {NAV_ITEMS.filter((n) => n.group === g.name).map((n) => {
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

          {/* 底部状态栏 */}
          <div className="main-footer">
            <span className="status" title={storageRoot}>{status}</span>
          </div>
        </main>
      </div>

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onChange={updateSettings}
        onClose={() => setSettingsOpen(false)}
        onStatus={setStatus}
      />
    </div>
  )
}
