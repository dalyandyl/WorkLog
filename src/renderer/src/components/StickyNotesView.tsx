import { useEffect, useState } from 'react'
import {
  Check,
  CheckCheck,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Save,
  StickyNote as StickyNoteIcon,
  Trash2,
  X
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { StickyNote } from '../types'

interface StickyNotesViewProps {
  onStatus: (msg: string) => void
}

type SectionAccent = 'amber' | 'gray' | 'green'

interface SectionSpec {
  title: string
  done: boolean
  icon: LucideIcon
  accent: SectionAccent
}

/** 便签管理页：新增 / 置顶 / 标记完成 / 编辑 / 删除；置顶且未完成的便签会出现在日报中 */
export default function StickyNotesView({ onStatus }: StickyNotesViewProps) {
  const [notes, setNotes] = useState<StickyNote[]>([])
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  function refresh(): void {
    window.api.listStickyNotes().then(setNotes)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function addNote(): Promise<void> {
    const text = draft.trim()
    if (!text) {
      onStatus('请输入便签内容')
      return
    }
    await window.api.addStickyNote(text)
    setDraft('')
    onStatus('已添加便签（默认置顶，将出现在日报中）')
    refresh()
  }

  async function togglePin(n: StickyNote): Promise<void> {
    await window.api.updateStickyNote(n.id, { pinned: !n.pinned })
    refresh()
    onStatus(n.pinned ? '已取消置顶（不再出现在日报）' : '已置顶（将出现在日报中）')
  }

  async function toggleComplete(n: StickyNote): Promise<void> {
    await window.api.updateStickyNote(n.id, { completed: !n.completed })
    refresh()
    onStatus(n.completed ? '已标记完成（从日报移除）' : '已取消完成（可重新置顶到日报）')
  }

  function startEdit(n: StickyNote): void {
    setEditingId(n.id)
    setEditingText(n.text)
  }

  async function saveEdit(n: StickyNote): Promise<void> {
    const text = editingText.trim()
    if (!text) {
      onStatus('便签内容不能为空')
      return
    }
    await window.api.updateStickyNote(n.id, { text })
    setEditingId(null)
    onStatus('已保存便签')
    refresh()
  }

  function del(n: StickyNote): void {
    if (!window.confirm('确定删除这张便签？此操作不可恢复。')) return
    window.api.deleteStickyNote(n.id).then((r) => {
      if (r.ok) {
        if (editingId === n.id) setEditingId(null)
        onStatus('已删除便签')
        refresh()
      }
    })
  }

  const pinned = notes.filter((n) => n.pinned && !n.completed)
  const unpinned = notes.filter((n) => !n.pinned && !n.completed)
  const completed = notes.filter((n) => n.completed)

  function renderNote(n: StickyNote, done: boolean): React.ReactNode {
    const editing = editingId === n.id
    return (
      <div key={n.id} className={'sticky-card' + (done ? ' done' : '') + (n.pinned && !done ? ' pinned' : '')}>
        {n.pinned && !done && (
          <span className="sticky-pin-badge">
            <Pin size={11} />
            置顶
          </span>
        )}
        <div className="sticky-card-top">
          {editing ? (
            <input
              className="sticky-edit-input"
              value={editingText}
              autoFocus
              onChange={(e) => setEditingText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveEdit(n)
                if (e.key === 'Escape') setEditingId(null)
              }}
            />
          ) : (
            <span className="sticky-text">{n.text}</span>
          )}
          <div className="sticky-card-actions" onClick={(e) => e.stopPropagation()}>
            {!done && (
              <button className="icon-btn" onClick={() => toggleComplete(n)} title="标记完成（从日报移除）">
                <Check size={15} />
              </button>
            )}
            {done && (
              <button className="icon-btn" onClick={() => toggleComplete(n)} title="取消完成">
                <Check size={15} className="recheck" />
              </button>
            )}
            {!done && (
              <button
                className={'icon-btn' + (n.pinned ? ' active' : '')}
                onClick={() => togglePin(n)}
                title={n.pinned ? '取消置顶（不再出现在日报）' : '置顶（出现在日报）'}
              >
                {n.pinned ? <Pin size={15} /> : <PinOff size={15} />}
              </button>
            )}
            {editing ? (
              <>
                <button className="icon-btn primary" onClick={() => saveEdit(n)} title="保存">
                  <Save size={15} />
                </button>
                <button className="icon-btn" onClick={() => setEditingId(null)} title="取消">
                  <X size={15} />
                </button>
              </>
            ) : (
              <button className="icon-btn" onClick={() => startEdit(n)} title="编辑内容">
                <Pencil size={15} />
              </button>
            )}
            <button className="icon-btn danger" onClick={() => del(n)} title="删除便签">
              <Trash2 size={15} />
            </button>
          </div>
        </div>
        <div className="sticky-card-time muted">
          {done
            ? `完成于 ${new Date(n.completedAt ?? n.createdAt).toLocaleString()}`
            : `创建于 ${new Date(n.createdAt).toLocaleString()}`}
        </div>
      </div>
    )
  }

  function renderSection(spec: SectionSpec, list: StickyNote[]): React.ReactNode {
    if (list.length === 0) return null
    const Icon = spec.icon
    return (
      <div className={'sticky-section' + (spec.done ? ' done' : '')}>
        <div className="sticky-section-head">
          <span className={'sticky-section-icon ' + spec.accent}>
            <Icon size={14} />
          </span>
          <h3 className="sticky-section-title">{spec.title}</h3>
          <span className="sticky-count">{list.length}</span>
        </div>
        <div className="sticky-grid">{list.map((n) => renderNote(n, spec.done))}</div>
      </div>
    )
  }

  const sections: SectionSpec[] = [
    { title: '置顶中', done: false, icon: Pin, accent: 'amber' },
    { title: '未置顶', done: false, icon: PinOff, accent: 'gray' },
    { title: '已完成', done: true, icon: CheckCheck, accent: 'green' }
  ]

  return (
    <div className="sticky-view">
      <div className="sticky-toolbar">
        <div className="sticky-toolbar-brand">
          <span className="sticky-toolbar-icon">
            <StickyNoteIcon size={18} />
          </span>
          <div>
            <div className="sticky-toolbar-title">便签</div>
            <div className="sticky-toolbar-sub">非紧急任务的每日提醒 · 置顶便签显示在日报任务列表上方</div>
          </div>
        </div>
        <div className="sticky-toolbar-add">
          <input
            className="search-input sticky-add-input"
            placeholder="写下一件想提醒自己的事…（回车添加，默认置顶）"
            value={draft}
            maxLength={500}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addNote()
            }}
          />
          <button className="new-meeting-btn" onClick={() => void addNote()}>
            <Plus size={14} />
            添加便签
          </button>
        </div>
      </div>

      {/* 概览统计（仿统计页） */}
      <div className="sticky-stat-cards">
        <div className="sticky-stat-card">
          <span className="sticky-stat-icon blue">
            <StickyNoteIcon size={18} />
          </span>
          <div>
            <div className="sticky-stat-num">{notes.length}</div>
            <div className="sticky-stat-label">全部便签</div>
          </div>
        </div>
        <div className="sticky-stat-card">
          <span className="sticky-stat-icon amber">
            <Pin size={18} />
          </span>
          <div>
            <div className="sticky-stat-num">{pinned.length}</div>
            <div className="sticky-stat-label">置顶中（显示在日报）</div>
          </div>
        </div>
        <div className="sticky-stat-card">
          <span className="sticky-stat-icon gray">
            <PinOff size={18} />
          </span>
          <div>
            <div className="sticky-stat-num">{unpinned.length}</div>
            <div className="sticky-stat-label">未置顶（仅此处可见）</div>
          </div>
        </div>
        <div className="sticky-stat-card">
          <span className="sticky-stat-icon green">
            <CheckCheck size={18} />
          </span>
          <div>
            <div className="sticky-stat-num">{completed.length}</div>
            <div className="sticky-stat-label">已完成</div>
          </div>
        </div>
      </div>

      <div className="sticky-sections">
        {notes.length === 0 ? (
          <div className="sticky-empty">
            <span className="sticky-empty-icon">
              <StickyNoteIcon size={30} />
            </span>
            <p>还没有便签</p>
            <span>用上面的输入框写下一件想提醒自己的事吧</span>
          </div>
        ) : (
          <>
            {renderSection(sections[0], pinned)}
            {renderSection(sections[1], unpinned)}
            {renderSection(sections[2], completed)}
          </>
        )}
      </div>
    </div>
  )
}
