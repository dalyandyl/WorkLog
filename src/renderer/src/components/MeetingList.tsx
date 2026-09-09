import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Download,
  FolderOpen,
  Image as ImageIcon,
  Paperclip,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import type { Meeting, Tag } from '../types'
import Modal from './Modal'
import Drawer from './Drawer'
import MeetingEditor from './MeetingEditor'
import DatePicker from './DatePicker'
import DropdownSelect from './DropdownSelect'

interface MeetingListProps {
  tags: Tag[]
  onStatus?: (msg: string) => void
}

type ViewMode = 'card' | 'timeline'
type SortMode = 'time' | 'created'

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function stripHtml(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return (div.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

/** 会议只读详情（右侧抽屉） */
function MeetingDetail({
  meeting,
  tagMap,
  onEdit,
  onExport,
  onDelete
}: {
  meeting: Meeting
  tagMap: Map<string, Tag>
  onEdit: () => void
  onExport: () => void
  onDelete: () => void
}) {
  function onClickCapture(e: React.MouseEvent): void {
    const target = e.target as HTMLElement
    const a = target.closest?.('a') as HTMLAnchorElement | null
    if (a && (a.getAttribute('href') ?? '').startsWith('wlattach://')) {
      e.preventDefault()
      e.stopPropagation()
      void window.api.openAttachment(a.getAttribute('href') ?? '')
    }
  }

  return (
    <div className="meeting-detail">
      <div className="meeting-detail-meta">
        <h3 className="meeting-detail-title">{meeting.title || '未命名会议'}</h3>
        <span className="meeting-detail-date">
          <CalendarDays size={13} />
          {meeting.date}
        </span>
        <div className="meeting-card-tags">
          {meeting.tags.map((id) => {
            const t = tagMap.get(id)
            return t ? (
              <span key={id} className="task-item-tag" style={{ borderColor: t.color, color: t.color }}>
                {t.name}
              </span>
            ) : null
          })}
          {meeting.tags.length === 0 && <span className="muted">（无标签）</span>}
        </div>
      </div>

      {meeting.attachments.length > 0 && (
        <div className="meeting-detail-attachments">
          <div className="attach-label">附件（{meeting.attachments.length}）</div>
          <div className="meeting-attach-list">
            {meeting.attachments.map((a) => (
              <div key={a.id} className="meeting-attach-item">
                <span className="attach-icon">{a.type === 'image' ? <ImageIcon size={14} /> : <Paperclip size={14} />}</span>
                <span className="attach-name" title={a.name}>{a.name}</span>
                <button
                  className="icon-btn"
                  title="打开附件"
                  onClick={() => void window.api.openAttachment(a.url)}
                >
                  <FolderOpen size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        className="rich-content rich-view meeting-detail-body"
        onClickCapture={onClickCapture}
        dangerouslySetInnerHTML={{ __html: meeting.body || '<p></p>' }}
      />

      <div className="meeting-detail-actions">
        <button className="action-btn save-btn" onClick={onEdit}><Pencil size={14} /> 编辑</button>
        <button className="ghost-btn" onClick={onExport}><Download size={14} /> 导出</button>
        <button className="icon-btn danger" onClick={onDelete} title="删除会议"><Trash2 size={15} /></button>
      </div>
    </div>
  )
}

export default function MeetingList({ tags, onStatus }: MeetingListProps) {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [query, setQuery] = useState('')
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortBy, setSortBy] = useState<SortMode>('time')
  const [view, setView] = useState<ViewMode>('card')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Meeting | null>(null)
  const [detail, setDetail] = useState<Meeting | null>(null)

  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags])

  useEffect(() => {
    refresh()
  }, [])

  function refresh(): void {
    window.api.listMeetings().then(setMeetings)
  }

  function openNew(): void {
    setEditing(null)
    setEditorOpen(true)
  }

  function openEdit(m: Meeting): void {
    setDetail(null)
    setEditing(m)
    setEditorOpen(true)
  }

  function deleteMeeting(m: Meeting): void {
    if (!window.confirm(`确定删除会议「${m.title || '未命名会议'}」？此操作不可恢复。`)) return
    window.api.deleteMeeting(m.id).then((r: { ok: boolean }) => {
      if (r.ok) {
        setDetail(null)
        refresh()
        onStatus?.(`已删除会议「${m.title || '未命名会议'}」`)
      }
    })
  }

  function exportMeeting(m: Meeting): void {
    window.api.exportMeeting(m).then((r) => {
      if (r.ok) onStatus?.(`已导出：${r.path}`)
      else if (!r.canceled && r.error) onStatus?.('导出失败：' + r.error)
    })
  }

  // 组合筛选 + 排序（全量数据在前端完成）
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = meetings
    if (q) {
      list = list.filter((m) => {
        if (m.title.toLowerCase().includes(q)) return true
        if (stripHtml(m.body).toLowerCase().includes(q)) return true
        return m.attachments.some((a) => a.name.toLowerCase().includes(q))
      })
    }
    if (selectedTagId) list = list.filter((m) => m.tags.includes(selectedTagId))
    if (dateFrom) list = list.filter((m) => m.date >= dateFrom)
    if (dateTo) list = list.filter((m) => m.date <= dateTo)
    return [...list].sort((a, b) => {
      if (sortBy === 'created') {
        return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
      }
      if (a.date !== b.date) return a.date > b.date ? -1 : 1
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
    })
  }, [meetings, query, selectedTagId, dateFrom, dateTo, sortBy])

  // 时间轴视图：按日期分组
  const byDate = useMemo(() => {
    const map = new Map<string, Meeting[]>()
    for (const m of filtered) {
      const arr = map.get(m.date) ?? []
      arr.push(m)
      map.set(m.date, arr)
    }
    return Array.from(map.entries())
  }, [filtered])

  function dateHeader(d: string): string {
    const today = new Date().toISOString().slice(0, 10)
    const label = d === today ? '今天' : d
    const wd = WEEKDAY_NAMES[new Date(d + 'T00:00:00').getDay()]
    return `${label} · ${wd}`
  }

  function renderTags(m: Meeting): React.ReactNode {
    return (
      <>
        {m.tags.map((id) => {
          const t = tagMap.get(id)
          return t ? (
            <span key={id} className="task-item-tag" style={{ borderColor: t.color, color: t.color }}>
              {t.name}
            </span>
          ) : null
        })}
        {m.attachments.length > 0 && (
          <span className="meeting-attach-count"><Paperclip size={12} /> {m.attachments.length}</span>
        )}
      </>
    )
  }

  function renderCard(m: Meeting): React.ReactNode {
    const summary = stripHtml(m.body)
    return (
      <div key={m.id} className="meeting-card" onClick={() => setDetail(m)}>
        <div className="meeting-card-info">
          <h4 className="meeting-title">{m.title || '未命名会议'}</h4>
          <span className="meeting-date-time">
            <CalendarDays size={12} />
            {m.date}
          </span>
          {summary && <p className="meeting-card-summary">{truncate(summary, 140)}</p>}
          <div className="meeting-card-tags">{renderTags(m)}</div>
        </div>
        <div className="meeting-card-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" onClick={() => exportMeeting(m)} title="导出 Markdown"><Download size={15} /></button>
          <button className="icon-btn" onClick={() => openEdit(m)} title="编辑会议"><Pencil size={15} /></button>
          <button className="icon-btn danger" onClick={() => deleteMeeting(m)} title="删除会议"><Trash2 size={15} /></button>
        </div>
      </div>
    )
  }

  function renderTimelineItem(m: Meeting): React.ReactNode {
    const summary = stripHtml(m.body)
    return (
      <div key={m.id} className="timeline-item" onClick={() => setDetail(m)}>
        <div className="timeline-content">
          <h4>{m.title || '未命名会议'}</h4>
          {summary && <p className="meeting-card-summary">{truncate(summary, 140)}</p>}
          <div className="meeting-card-tags">{renderTags(m)}</div>
        </div>
        <div className="meeting-card-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" onClick={() => exportMeeting(m)} title="导出 Markdown"><Download size={15} /></button>
          <button className="icon-btn" onClick={() => openEdit(m)} title="编辑会议"><Pencil size={15} /></button>
          <button className="icon-btn danger" onClick={() => deleteMeeting(m)} title="删除会议"><Trash2 size={15} /></button>
        </div>
      </div>
    )
  }

  return (
    <div className="meeting-list">
      {/* 顶部操作栏：搜索 / 筛选 / 排序 / 视图切换 / 新建 */}
      <div className="meeting-list-header">
        <input
          className="search-input meeting-search"
          placeholder="搜索标题、正文、附件名..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <DropdownSelect
          value={selectedTagId ?? ''}
          options={[{ value: '', label: '全部标签' }, ...tags.map((t) => ({ value: t.id, label: t.name }))]}
          onChange={(v) => setSelectedTagId(v || null)}
          title="按标签筛选"
        />
        <DatePicker value={dateFrom} onChange={setDateFrom} title="开始日期" />
        <span className="date-range-sep">~</span>
        <DatePicker value={dateTo} onChange={setDateTo} title="结束日期" />
        <DropdownSelect
          value={sortBy}
          options={[
            { value: 'time', label: '按会议日期' },
            { value: 'created', label: '按创建时间' }
          ]}
          onChange={(v) => setSortBy(v as SortMode)}
          title="排序方式"
        />
        <div className="meeting-view-toggle">
          <button className={view === 'card' ? 'active' : ''} onClick={() => setView('card')} title="卡片视图">
            ▦ 卡片
          </button>
          <button className={view === 'timeline' ? 'active' : ''} onClick={() => setView('timeline')} title="时间轴视图">
            ≡ 时间轴
          </button>
        </div>
        <button className="new-meeting-btn" onClick={openNew}>
          <Plus size={14} />
          新建会议
        </button>
      </div>

      {/* 会议列表（卡片 / 时间轴） */}
      {filtered.length === 0 ? (
        <div className="task-empty">
          {meetings.length === 0 ? '暂无会议纪要' : '没有符合条件的会议'}
        </div>
      ) : view === 'card' ? (
        <div className="meeting-cards">{filtered.map((m) => renderCard(m))}</div>
      ) : (
        <div className="meeting-timeline">
          {byDate.map(([d, list]) => (
            <div key={d} className="timeline-group">
              <div className="timeline-date-header">
                <CalendarDays size={12} />
                {dateHeader(d)}
              </div>
              {list.map((m) => renderTimelineItem(m))}
            </div>
          ))}
        </div>
      )}

      {/* 只读详情抽屉（单击会议打开） */}
      <Drawer open={detail !== null} title="会议详情" width={620} onClose={() => setDetail(null)}>
        {detail && (
          <MeetingDetail
            meeting={detail}
            tagMap={tagMap}
            onEdit={() => openEdit(detail)}
            onExport={() => exportMeeting(detail)}
            onDelete={() => deleteMeeting(detail)}
          />
        )}
      </Drawer>

      {/* 编辑 / 新建模态框 */}
      <Modal
        open={editorOpen}
        title={editing ? '编辑会议纪要' : '新建会议纪要'}
        width={960}
        height={760}
        onClose={() => setEditorOpen(false)}
      >
        <MeetingEditor
          key={editing?.id ?? 'new'}
          tags={tags}
          meeting={editing}
          onSave={(m) => {
            refresh()
            onStatus?.(`已保存会议「${m.title}」`)
          }}
          onClose={() => setEditorOpen(false)}
          onStatus={onStatus}
        />
      </Modal>
    </div>
  )
}
