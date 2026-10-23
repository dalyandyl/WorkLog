import { confirmDialog } from './confirm'
import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Download,
  FileText,
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
import { handleAttachmentClick } from '../utils/attachmentActions'

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
    if (handleAttachmentClick(e)) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  return (
    <div className="md-view">
      <div className="md-meta">
        <h2 className="md-title">{meeting.title || '未命名会议'}</h2>
        <div className="md-sub">
          <span className="md-date">
            <CalendarDays size={13} />
            {meeting.date}
          </span>
          <span className="md-wd">
            {WEEKDAY_NAMES[new Date(meeting.date + 'T00:00:00').getDay()]}
          </span>
          <span className="md-tags">
            {meeting.tags.map((id) => {
              const t = tagMap.get(id)
              return t ? (
                <span key={id} className="tag" style={{ '--c': t.color } as React.CSSProperties}>
                  {t.name}
                </span>
              ) : null
            })}
            {meeting.tags.length === 0 && <span className="muted">无标签</span>}
          </span>
        </div>
      </div>

      <div className="md-section">
        <div className="md-sec-head">
          <FileText size={14} />
          会议纪要
          <span className="md-sec-hint">{stripHtml(meeting.body).length} 字</span>
        </div>
        <div
          className="rich-content rich-view md-body"
          onClickCapture={onClickCapture}
          dangerouslySetInnerHTML={{ __html: meeting.body || '<p class="md-empty">还没有正文，点「编辑」补充。</p>' }}
        />
      </div>

      {meeting.attachments.length > 0 && (
        <div className="md-section">
          <div className="md-sec-head">
            <Paperclip size={14} />
            附件
            <span className="md-sec-hint">{meeting.attachments.length}</span>
          </div>
          <div className="md-attach-list">
            {meeting.attachments.map((a) => (
              <div key={a.id} className="md-attach">
                <span className="md-attach-icon">
                  {a.type === 'image' ? <ImageIcon size={14} /> : <Paperclip size={14} />}
                </span>
                <span className="md-attach-name" title={a.name}>
                  {a.name}
                </span>
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

      <div className="md-actions">
        <button className="btn btn--primary" onClick={onEdit}>
          <Pencil size={14} />
          编辑
        </button>
        <button className="btn" onClick={onExport}>
          <Download size={14} />
          导出
        </button>
        <button className="btn btn--icon btn--danger" onClick={onDelete} title="删除会议">
          <Trash2 size={15} />
        </button>
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

  async function deleteMeeting(m: Meeting): Promise<void> {
    if (!await confirmDialog(`确定删除会议「${m.title || '未命名会议'}」？此操作不可恢复。`)) return
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
            <span key={id} className="tag" style={{ '--c': t.color } as React.CSSProperties}>
              {t.name}
            </span>
          ) : null
        })}
        {m.attachments.length > 0 && (
          <span className="mt-attach-n">
            <Paperclip size={12} /> {m.attachments.length}
          </span>
        )}
      </>
    )
  }

  function renderCard(m: Meeting): React.ReactNode {
    const summary = stripHtml(m.body)
    return (
      <div key={m.id} className="mt-card" onClick={() => setDetail(m)}>
        <div className="mt-card-top">
          <h4 className="mt-card-title">{m.title || '未命名会议'}</h4>
          <div className="mt-card-actions" onClick={(e) => e.stopPropagation()}>
            <button className="btn btn--icon btn--sm" onClick={() => exportMeeting(m)} title="导出 Markdown">
              <Download size={14} />
            </button>
            <button className="btn btn--icon btn--sm" onClick={() => openEdit(m)} title="编辑会议">
              <Pencil size={14} />
            </button>
            <button className="btn btn--icon btn--sm btn--danger" onClick={() => deleteMeeting(m)} title="删除会议">
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        <div className="mt-card-meta">
          <span className="mt-card-date">
            <CalendarDays size={12} />
            {m.date}
          </span>
          <span className="mt-card-wd">
            {WEEKDAY_NAMES[new Date(m.date + 'T00:00:00').getDay()]}
          </span>
        </div>
        {summary ? (
          <p className="mt-card-summary">{truncate(summary, 160)}</p>
        ) : (
          <p className="mt-card-summary mt-card-summary--empty">还没有正文</p>
        )}
        <div className="mt-card-foot">{renderTags(m)}</div>
      </div>
    )
  }

  function renderTimelineItem(m: Meeting): React.ReactNode {
    const summary = stripHtml(m.body)
    return (
      <div key={m.id} className="mt-tl-item" onClick={() => setDetail(m)}>
        <span className="mt-tl-dot" />
        <div className="mt-tl-card">
          <div className="mt-tl-top">
            <h4>{m.title || '未命名会议'}</h4>
            <div className="mt-card-actions" onClick={(e) => e.stopPropagation()}>
              <button className="btn btn--icon btn--sm" onClick={() => exportMeeting(m)} title="导出 Markdown">
                <Download size={14} />
              </button>
              <button className="btn btn--icon btn--sm" onClick={() => openEdit(m)} title="编辑会议">
                <Pencil size={14} />
              </button>
              <button className="btn btn--icon btn--sm btn--danger" onClick={() => deleteMeeting(m)} title="删除会议">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          {summary && <p className="mt-card-summary">{truncate(summary, 160)}</p>}
          <div className="mt-card-foot">{renderTags(m)}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="meeting-view">
      <header className="workhead">
        <div className="wh-left">
          <span className="wh-title">会议纪要</span>
          <span className="wh-sub">
            共 {meetings.length} 场
            {filtered.length !== meetings.length ? ` · 筛选出 ${filtered.length} 场` : ''}
          </span>
        </div>
        <div className="wh-right">
          <div className="seg">
            <button
              className={'seg-btn' + (view === 'card' ? ' on' : '')}
              onClick={() => setView('card')}
              title="卡片视图"
            >
              卡片
            </button>
            <button
              className={'seg-btn' + (view === 'timeline' ? ' on' : '')}
              onClick={() => setView('timeline')}
              title="时间轴视图"
            >
              时间轴
            </button>
          </div>
          <button className="btn btn--primary btn--sm" onClick={openNew}>
            <Plus size={14} />
            新建会议
          </button>
        </div>
      </header>

      <div className="with-side">
        <aside className="page-side">
          <input
            className="input"
            placeholder="搜索标题、正文、附件名…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="ps-head">
            <span>筛选</span>
          </div>
          <div className="ps-list ps-list--form">
            <DropdownSelect
              value={selectedTagId ?? ''}
              options={[{ value: '', label: '全部标签' }, ...tags.map((t) => ({ value: t.id, label: t.name }))]}
              onChange={(v) => setSelectedTagId(v || null)}
              title="按标签筛选"
            />
            <DropdownSelect
              value={sortBy}
              options={[
                { value: 'time', label: '按会议日期' },
                { value: 'created', label: '按创建时间' }
              ]}
              onChange={(v) => setSortBy(v as SortMode)}
              title="排序方式"
            />
            <div className="mt-range">
              <DatePicker value={dateFrom} onChange={setDateFrom} title="开始日期" />
              <span className="mt-range-sep">~</span>
              <DatePicker value={dateTo} onChange={setDateTo} title="结束日期" />
            </div>
          </div>

          <div className="ps-head">
            <span>最近会议</span>
            <span className="ps-count">{filtered.length}</span>
          </div>
          <div className="ps-list">
            {filtered.slice(0, 12).map((m) => (
              <button key={m.id} className="ps-item" onClick={() => setDetail(m)}>
                <span className="ps-item-name">{m.title || '未命名会议'}</span>
                <span className="ps-item-meta">{m.date.slice(5)}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="muted" style={{ fontSize: 11.5, padding: '6px 2px' }}>
                没有符合条件的会议
              </div>
            )}
          </div>
        </aside>

        <div className="page-main">
          <div className="workscroll">
            {filtered.length === 0 ? (
              <div className="empty-state">
                <CalendarDays size={26} />
                <div>{meetings.length === 0 ? '还没有会议纪要' : '没有符合条件的会议'}</div>
                {meetings.length === 0 && (
                  <button className="btn btn--sm" onClick={openNew}>
                    <Plus size={14} />
                    新建第一场
                  </button>
                )}
              </div>
            ) : view === 'card' ? (
              <div className="mt-grid">{filtered.map((m) => renderCard(m))}</div>
            ) : (
              <div className="mt-tl">
                {byDate.map(([d, list]) => (
                  <div key={d} className="mt-tl-group">
                    <div className="mt-tl-date">
                      <CalendarDays size={12} />
                      {dateHeader(d)}
                      <span className="mt-tl-count">{list.length}</span>
                    </div>
                    {list.map((m) => renderTimelineItem(m))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

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
