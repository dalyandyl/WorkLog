import { confirmDialog } from './confirm'
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

  async function del(n: StickyNote): Promise<void> {
    if (!await confirmDialog('确定删除这张便签？此操作不可恢复。')) return
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
        <div className="sticky-card-top">
          {n.pinned && !done && (
            <span className="sticky-pin-badge">
              <Pin size={11} />
              置顶
            </span>
          )}
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


  // 便签墙：左侧状态栏 + 瀑布流
  const [filter, setFilter] = useState<'all' | 'pinned' | 'unpinned' | 'done'>('all')
  const [q, setQ] = useState('')
  const filters: { key: 'all' | 'pinned' | 'unpinned' | 'done'; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: notes.length },
    { key: 'pinned', label: '置顶', count: pinned.length },
    { key: 'unpinned', label: '未置顶', count: unpinned.length },
    { key: 'done', label: '已完成', count: completed.length }
  ]
  const byFilter =
    filter === 'all' ? notes : filter === 'pinned' ? pinned : filter === 'unpinned' ? unpinned : completed
  const shown = q.trim()
    ? byFilter.filter((n) => n.text.toLowerCase().includes(q.trim().toLowerCase()))
    : byFilter

  return (
    <div className="sticky-view">
      <header className="workhead">
        <div className="wh-left">
          <span className="wh-title wh-title--hero">便签</span>
          <span className="wh-sub">置顶的便签会出现在日报任务上方</span>
        </div>
        <div className="wh-right stk-add-wrap">
          <textarea
            className="textarea stk-add"
            rows={2}
            placeholder="写下一件想提醒自己的事，Ctrl + 回车添加…"
            value={draft}
            maxLength={500}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void addNote()
              }
            }}
          />
          <button className="btn btn--primary btn--sm" onClick={() => void addNote()}>
            <Plus size={14} />
            添加
          </button>
        </div>
      </header>

      <div className="with-side">
        <aside className="page-side">
          <input
            className="input"
            placeholder="搜索便签…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="ps-head">
            <span>状态</span>
          </div>
          <div className="ps-list">
            {filters.map((f) => (
              <button
                key={f.key}
                className={'ps-item' + (filter === f.key ? ' on' : '')}
                onClick={() => setFilter(f.key)}
              >
                <span className="ps-item-name">{f.label}</span>
                <span className="ps-item-n">{f.count}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="page-main">
          <div className="workscroll">
            {notes.length === 0 ? (
              <div className="empty-state">
                <StickyNoteIcon size={26} />
                <div>还没有便签，用右上角的输入框写一条吧</div>
              </div>
            ) : shown.length === 0 ? (
              <div className="empty-state">
                <StickyNoteIcon size={26} />
                <div>{q.trim() ? '没有匹配的便签' : filter === 'done' ? '还没有已完成的便签' : '这个分组是空的'}</div>
              </div>
            ) : (
              <div className="stk-wall">{shown.map((n) => renderNote(n, n.completed))}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
