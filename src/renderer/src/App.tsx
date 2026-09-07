import { useEffect, useState } from 'react'
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
  }, [settings.theme])

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
        <div className="brand">📔 日志工具</div>
        <div className="mode-switch">
          <button className={mode === 'day' ? 'mode-btn active' : 'mode-btn'} onClick={() => setMode('day')}>
            日报
          </button>
          <button className={mode === 'week' ? 'mode-btn active' : 'mode-btn'} onClick={() => setMode('week')}>
            周报
          </button>
          <button className={mode === 'publish' ? 'mode-btn active' : 'mode-btn'} onClick={() => setMode('publish')}>
            任务发布
          </button>
          <button className={mode === 'stats' ? 'mode-btn active' : 'mode-btn'} onClick={() => setMode('stats')}>
            统计
          </button>
          <button className={mode === 'report' ? 'mode-btn active' : 'mode-btn'} onClick={() => setMode('report')}>
            报表
          </button>
          <button className={mode === 'tags' ? 'mode-btn active' : 'mode-btn'} onClick={() => setMode('tags')}>
            标签
          </button>
          <button className={mode === 'meeting' ? 'mode-btn active' : 'mode-btn'} onClick={() => setMode('meeting')}>
            会议
          </button>
          <button className={mode === 'trash' ? 'mode-btn active' : 'mode-btn'} onClick={() => setMode('trash')}>
            回收站
          </button>
        </div>
        <div className="topbar-right">
          <SearchBox onPick={(d, taskId) => { setMode('day'); setDate(d); setDaySel({ date: d, taskId }) }} />
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          <div className="sidebar-top">
            <Calendar selected={date} markers={taskDates} onSelect={selectDate} />
          </div>
          <div className="sidebar-bottom">
            <button className="sidebar-tool-btn" onClick={() => setSettingsOpen(true)} title="设置">
              ⚙️ 设置
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
