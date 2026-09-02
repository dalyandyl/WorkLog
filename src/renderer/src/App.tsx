import { useEffect, useState } from 'react'
import Calendar from './components/Calendar'
import SearchBox from './components/SearchBox'
import StatsView from './components/StatsView'
import TagManager from './components/TagManager'
import TaskPublish from './components/TaskPublish'
import TrashView from './components/TrashView'
import ReportView from './components/ReportView'
import WorkView from './components/WorkView'
import SettingsModal from './components/SettingsModal'
import Modal from './components/Modal'
import type { AppSettings, Tag } from './types'
import { toDateStr, weekInfoOf } from './utils/date'

type Mode = 'publish' | 'day' | 'stats' | 'report'

export default function App() {
  const [date, setDate] = useState(() => toDateStr(new Date()))
  const [mode, setMode] = useState<Mode>('publish')
  const [weekKey, setWeekKey] = useState(() => weekInfoOf(toDateStr(new Date())).weekKey)
  const [daySel, setDaySel] = useState<{ date: string; taskId: string | null }>({
    date: toDateStr(new Date()),
    taskId: null
  })
  const [settings, setSettings] = useState<AppSettings>({
    theme: 'system',
    reminder: { enabled: false, time: '18:00' },
    webdav: { enabled: false, url: '', username: '', password: '' }
  })
  const [tags, setTags] = useState<Tag[]>([])
  const [taskDates, setTaskDates] = useState<Set<string>>(new Set())
  const [storageRoot, setStorageRoot] = useState('')
  const [status, setStatus] = useState('加载中…')

  const [calOpen, setCalOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)

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
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">📔 日志工具</div>
        <div className="mode-switch">
          <button className={mode === 'publish' ? 'mode-btn active' : 'mode-btn'} onClick={() => setMode('publish')}>
            任务发布
          </button>
          <button className={mode === 'day' ? 'mode-btn active' : 'mode-btn'} onClick={() => setMode('day')}>
            日报 / 周报
          </button>
          <button className={mode === 'stats' ? 'mode-btn active' : 'mode-btn'} onClick={() => setMode('stats')}>
            统计
          </button>
          <button className={mode === 'report' ? 'mode-btn active' : 'mode-btn'} onClick={() => setMode('report')}>
            报表
          </button>
        </div>
        <div className="topbar-right">
          <SearchBox onPick={(d, taskId) => { setMode('day'); setDate(d); setDaySel({ date: d, taskId }) }} />
          <span className="status" title={storageRoot}>{status}</span>
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          <div className="sidebar-bottom">
            <button className="sidebar-tool-btn" onClick={() => setTagsOpen(true)} title="标签管理（全局）">
              🏷 标签
            </button>
            <button className="sidebar-tool-btn" onClick={() => setTrashOpen(true)} title="临时回收站（全局）">
              🗑 回收站
            </button>
            <button className="sidebar-tool-btn" onClick={() => setCalOpen((v) => !v)} title="展开日历">
              📅 日历
            </button>
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
              onGoToTags={() => setTagsOpen(true)}
            />
          )}

          {mode === 'day' && (
            <WorkView
              tags={tags}
              date={date}
              weekKey={weekKey}
              daySel={daySel}
              onDateChange={selectDate}
              onWeekChange={setWeekKey}
              onSelectTask={(id) => setDaySel({ date, taskId: id })}
              onTasksChanged={refreshTaskDates}
              onStatus={setStatus}
            />
          )}

          {mode === 'stats' && <StatsView date={date} />}

          {mode === 'report' && (
            <ReportView tags={tags} onStatus={setStatus} />
          )}
        </main>
      </div>

      {/* 标签 / 回收站弹窗（全局功能，不占主界面） */}
      <Modal open={tagsOpen} title="标签管理" width={860} onClose={() => setTagsOpen(false)}>
        <div className="modal-panel-scroll">
          <TagManager tags={tags} onChanged={refreshTags} onStatus={setStatus} />
        </div>
      </Modal>
      <Modal open={trashOpen} title="临时回收站" width={860} onClose={() => setTrashOpen(false)}>
        <div className="modal-panel-scroll">
          <TrashView onStatus={setStatus} onRestored={refreshTaskDates} />
        </div>
      </Modal>

      {/* 日历浮层（向上展开） */}
      {calOpen && (
        <div className="calendar-pop">
          <Calendar selected={date} markers={taskDates} onSelect={(d) => { selectDate(d); }} />
          <button className="calendar-pop-close" onClick={() => setCalOpen(false)}>收起 ▾</button>
        </div>
      )}

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
