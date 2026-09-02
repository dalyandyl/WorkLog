import { useEffect, useState } from 'react'
import Calendar from './components/Calendar'
import SearchBox from './components/SearchBox'
import StatsView from './components/StatsView'
import TagManager from './components/TagManager'
import TaskPublish from './components/TaskPublish'
import TrashView from './components/TrashView'
import ReportView from './components/ReportView'
import ProjectView from './components/ProjectView'
import SettingsModal from './components/SettingsModal'
import Modal from './components/Modal'
import type { AppSettings, Project, Tag } from './types'
import { toDateStr, weekInfoOf } from './utils/date'

type Mode = 'publish' | 'stats' | 'report' | 'project'

const DEFAULT_PROJECT_COLOR = '#8b5cf6'

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
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('uncategorized')
  const [taskDates, setTaskDates] = useState<Set<string>>(new Set())
  const [storageRoot, setStorageRoot] = useState('')
  const [status, setStatus] = useState('加载中…')

  const [calOpen, setCalOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [projectDialog, setProjectDialog] = useState<'add' | null>(null)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [projName, setProjName] = useState('')
  const [projError, setProjError] = useState<string | null>(null)

  useEffect(() => {
    window.api.getStorageRoot().then(setStorageRoot)
    window.api.listTaskDates().then((ds) => setTaskDates(new Set(ds)))
    window.api.listTags().then(setTags)
    window.api.getSettings().then(setSettings)
    window.api.listProjects().then((ps) => {
      setProjects(ps)
      setSelectedProjectId((cur) => (ps.some((p) => p.id === cur) ? cur : ps[0]?.id ?? 'uncategorized'))
    })
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
  function refreshProjects(): void {
    window.api.listProjects().then((ps) => {
      setProjects(ps)
      setSelectedProjectId((cur) => (ps.some((p) => p.id === cur) ? cur : ps[0]?.id ?? 'uncategorized'))
    })
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

  function enterProject(id: string): void {
    setSelectedProjectId(id)
    setMode('project')
  }

  function openAddProject(): void {
    setProjName('')
    setProjectDialog('add')
  }

  function openEditProject(p: Project): void {
    setEditProject(p)
    setProjName(p.name)
    setProjectDialog('add')
  }

  async function submitProject(): Promise<void> {
    const v = projName.trim()
    if (!v) return
    if (editProject) {
      const r = await window.api.renameProject(editProject.id, v)
      if (!r) {
        setProjError(`项目「${v}」已存在`)
        return
      }
      onCloseProjectDialog()
      refreshProjects()
      setStatus('已重命名项目')
    } else {
      const p = await window.api.createProject(v, DEFAULT_PROJECT_COLOR)
      if (!p) {
        setProjError(`项目「${v}」已存在`)
        return
      }
      onCloseProjectDialog()
      refreshProjects()
      setSelectedProjectId(p.id)
      setMode('project')
      setStatus('已创建项目')
    }
  }

  function onCloseProjectDialog(): void {
    setProjectDialog(null)
    setEditProject(null)
    setProjError(null)
    setProjName('')
  }

  async function deleteProject(p: Project): Promise<void> {
    if (p.id === 'uncategorized') {
      setProjError('「未分类」为默认项目，不可删除')
      return
    }
    if (window.confirm(`删除项目「${p.name}」？该项目下的任务将归入「未分类」。`)) {
      await window.api.deleteProject(p.id)
      refreshProjects()
      setStatus('已删除项目')
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">📔 日志工具</div>
        <div className="mode-switch">
          <button className={mode === 'publish' ? 'mode-btn active' : 'mode-btn'} onClick={() => setMode('publish')}>
            任务发布
          </button>
          <button className={mode === 'stats' ? 'mode-btn active' : 'mode-btn'} onClick={() => setMode('stats')}>
            统计
          </button>
          <button className={mode === 'report' ? 'mode-btn active' : 'mode-btn'} onClick={() => setMode('report')}>
            报表
          </button>
        </div>
        <div className="topbar-right">
          <SearchBox onPick={(d, taskId) => { setMode('project'); setDate(d); setDaySel({ date: d, taskId }) }} projects={projects} />
          <span className="status" title={storageRoot}>{status}</span>
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          <div className="project-menu">
            <div className="project-menu-title">项目</div>
            <div className="project-menu-list">
              {projects.map((p) => (
                <div
                  key={p.id}
                  className={
                    'project-menu-item' +
                    (mode === 'project' && selectedProjectId === p.id ? ' active' : '')
                  }
                  onClick={() => enterProject(p.id)}
                  title={p.name}
                >
                  <span className="project-folder">📁</span>
                  <span className="project-menu-name">{p.name}</span>
                  <span className="project-menu-ops">
                    <button
                      className="icon-btn"
                      onClick={(e) => { e.stopPropagation(); openEditProject(p) }}
                      title="重命名项目"
                    >
                      ✏️
                    </button>
                    <button
                      className="icon-btn danger"
                      onClick={(e) => { e.stopPropagation(); deleteProject(p) }}
                      title="删除项目"
                    >
                      🗑
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <button className="project-add-btn" onClick={openAddProject}>
              ＋ 新建项目
            </button>
          </div>

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
              projectId={selectedProjectId}
              onStatus={setStatus}
              onPublished={refreshTaskDates}
              onGoToTags={() => setTagsOpen(true)}
            />
          )}

          {mode === 'project' && (
            <ProjectView
              projectId={selectedProjectId}
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

          {mode === 'stats' && <StatsView date={date} projectId={selectedProjectId} />}

          {mode === 'report' && (
            <ReportView tags={tags} projectId={selectedProjectId} onStatus={setStatus} />
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

      {/* 新建/重命名项目弹窗 */}
      <Modal open={projectDialog !== null} title={editProject ? '重命名项目' : '新建项目'} width={420} onClose={onCloseProjectDialog}>
        <div className="tag-create-form">
          <label className="tag-create-label">项目名称</label>
          <input
            className="tag-create-name"
            placeholder="项目名称"
            autoFocus
            value={projName}
            onChange={(e) => setProjName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitProject() }}
          />
          {projError && <div className="tag-error-msg">{projError}</div>}
          <div className="tag-create-actions">
            <button className="tag-create-btn" onClick={submitProject} disabled={!projName.trim()}>
              {editProject ? '保存' : '创建'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
