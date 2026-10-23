import { confirmDialog } from './confirm'
import { useEffect, useState, type ReactElement } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  CheckSquare,
  RotateCcw,
  Square,
  StickyNote,
  Tag as TagIcon,
  Trash2,
  Users
} from 'lucide-react'
import type { TrashItem, TrashKind } from '../types'
import Drawer from './Drawer'
import RichView from './RichView'

interface TrashViewProps {
  onStatus: (msg: string) => void
  onRestored: () => void
}

/** 回收站保留天数（与主进程一致：删除后 30 天内可恢复） */
const KEEP_DAYS = 30

type Filter = 'all' | TrashKind

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'task', label: '任务' },
  { key: 'meeting', label: '会议' },
  { key: 'note', label: '便签' },
  { key: 'tag', label: '标签' }
]

function daysLeft(deletedAt: string): number {
  const gone = Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86400000)
  return Math.max(0, KEEP_DAYS - gone)
}

function kindOf(item: TrashItem): TrashKind {
  return item.kind ?? 'task'
}

function typeOf(item: TrashItem): string {
  switch (kindOf(item)) {
    case 'meeting':
      return '会议'
    case 'note':
      return '便签'
    case 'tag':
      return '标签'
    default: {
      const n = (item.tasks ?? []).length
      return n > 1 ? `区间任务 · ${n} 天` : '单日任务'
    }
  }
}

function iconOf(item: TrashItem): ReactElement {
  switch (kindOf(item)) {
    case 'meeting':
      return <Users size={14} />
    case 'note':
      return <StickyNote size={14} />
    case 'tag':
      return <TagIcon size={14} />
    default:
      return <CalendarDays size={14} />
  }
}

export default function TrashView({ onStatus, onRestored }: TrashViewProps) {
  const [items, setItems] = useState<TrashItem[]>([])
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [detail, setDetail] = useState<TrashItem | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  function refresh(): void {
    window.api.listTrash().then((all) => {
      setItems(all)
      setPicked((prev) => new Set([...prev].filter((id) => all.some((x) => x.id === id))))
    })
  }

  useEffect(() => {
    refresh()
  }, [])

  async function restore(ids: string[]): Promise<void> {
    for (const id of ids) await window.api.restoreTrash(id)
    onStatus(ids.length > 1 ? `已恢复 ${ids.length} 项` : '已恢复')
    setPicked(new Set())
    onRestored()
    refresh()
  }

  async function remove(ids: string[]): Promise<void> {
    const tip =
      ids.length > 1
        ? `永久删除选中的 ${ids.length} 项？此操作不可恢复。`
        : '永久删除这一项？此操作不可恢复。'
    if (!(await confirmDialog(tip))) return
    for (const id of ids) await window.api.removeTrash(id)
    onStatus(ids.length > 1 ? `已永久删除 ${ids.length} 项` : '已永久删除')
    setPicked(new Set())
    refresh()
  }

  async function clear(): Promise<void> {
    if (!(await confirmDialog('清空回收站？所有条目将被永久删除，不可恢复。'))) return
    await window.api.clearTrash()
    onStatus('已清空回收站')
    setPicked(new Set())
    refresh()
  }

  function togglePick(id: string): void {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const shown = filter === 'all' ? items : items.filter((x) => kindOf(x) === filter)
  const shownAllPicked = shown.length > 0 && shown.every((x) => picked.has(x.id))

  function countOf(f: Filter): number {
    return f === 'all' ? items.length : items.filter((x) => kindOf(x) === f).length
  }

  return (
    <div className="trash-view">
      <header className="workhead">
        <div className="wh-left">
          <span className="wh-title wh-title--hero">回收站</span>
          <span className="wh-sub">
            {items.length} 项 · 保留 {KEEP_DAYS} 天，到期自动清理
          </span>
        </div>
        <div className="wh-right">
          {picked.size > 0 && (
            <>
              <button className="btn btn--sm" onClick={() => void restore([...picked])}>
                <RotateCcw size={14} />
                恢复 {picked.size} 项
              </button>
              <button className="btn btn--sm btn--danger" onClick={() => void remove([...picked])}>
                <Trash2 size={14} />
                永久删除
              </button>
            </>
          )}
        </div>
      </header>

      <div className="with-side">
        <aside className="page-side">
          <div className="ps-head">
            <span>类型</span>
          </div>
          <div className="ps-list">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={'ps-item' + (filter === f.key ? ' on' : '')}
                onClick={() => setFilter(f.key)}
              >
                <span className="ps-item-name">{f.label}</span>
                <span className="ps-item-n">{countOf(f.key)}</span>
              </button>
            ))}
          </div>

          <div className="ps-hint ps-hint--warn">
            <AlertTriangle size={13} />
            回收站保留 {KEEP_DAYS} 天；删除区间任务会连带删除区间内所有副本
          </div>

          <button
            className="btn btn--sm btn--danger ps-bottom"
            onClick={() => void clear()}
            disabled={items.length === 0}
          >
            <Trash2 size={14} />
            清空回收站
          </button>
        </aside>

        <div className="page-main">
          <div className="workscroll">
            {items.length === 0 ? (
              <div className="empty-state">
                <Trash2 size={26} />
                <div>回收站是空的</div>
              </div>
            ) : shown.length === 0 ? (
              <div className="empty-state">
                <Trash2 size={26} />
                <div>这个分类下没有条目</div>
              </div>
            ) : (
              <div className="trash-table card card--flush">
                <div className="trash-row trash-row--head">
                  <button
                    className="trash-check"
                    title={shownAllPicked ? '取消全选' : '全选'}
                    onClick={() =>
                      setPicked(
                        shownAllPicked
                          ? new Set()
                          : new Set([...picked, ...shown.map((x) => x.id)])
                      )
                    }
                  >
                    {shownAllPicked ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                  <span>名称</span>
                  <span>类型</span>
                  <span>删除时间</span>
                  <span>剩余</span>
                  <span>操作</span>
                </div>
                {shown.map((item) => (
                  <div
                    key={item.id}
                    className={'trash-row is-clickable' + (picked.has(item.id) ? ' on' : '')}
                    onClick={() => setDetail(item)}
                    title="点击查看详情"
                  >
                    <button
                      className="trash-check"
                      onClick={(e) => {
                        e.stopPropagation()
                        togglePick(item.id)
                      }}
                    >
                      {picked.has(item.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                    <span className="trash-name" title={item.title}>
                      <span className="trash-kind-icon">{iconOf(item)}</span>
                      {item.title}
                    </span>
                    <span className="trash-type">{typeOf(item)}</span>
                    <span className="trash-time">{new Date(item.deletedAt).toLocaleString()}</span>
                    <span className={'trash-left' + (daysLeft(item.deletedAt) <= 3 ? ' warn' : '')}>
                      {daysLeft(item.deletedAt)} 天
                    </span>
                    <span className="trash-ops" onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn--sm btn--ghost" onClick={() => void restore([item.id])}>
                        恢复
                      </button>
                      <button
                        className="btn btn--icon btn--sm"
                        title="永久删除"
                        onClick={() => void remove([item.id])}
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Drawer
        open={detail !== null}
        title={detail ? `${detail.title} · 详情` : ''}
        width={620}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <div className="trash-detail">
            <div className="trash-detail-meta">
              <span className={`pill ${typeOf(detail) !== '单日任务' ? 'pill--accent' : ''}`}>
                {typeOf(detail)}
              </span>
              <span className="muted">删除于 {new Date(detail.deletedAt).toLocaleString()}</span>
              <span className={'trash-left' + (daysLeft(detail.deletedAt) <= 3 ? ' warn' : '')}>
                剩余 {daysLeft(detail.deletedAt)} 天
              </span>
            </div>

            {kindOf(detail) === 'meeting' && detail.meeting && (
              <section className="trash-detail-sec">
                <div className="trash-detail-date">
                  {detail.meeting.date}
                  {detail.meeting.tags.length > 0 && (
                    <span className="muted">· {detail.meeting.tags.length} 个标签</span>
                  )}
                </div>
                {detail.meeting.body ? (
                  <RichView content={detail.meeting.body} />
                ) : (
                  <div className="muted">（无正文）</div>
                )}
              </section>
            )}

            {kindOf(detail) === 'note' && detail.note && (
              <section className="trash-detail-sec">
                <p className="trash-detail-text">{detail.note.text}</p>
                <div className="muted">
                  创建于 {new Date(detail.note.createdAt).toLocaleString()}
                  {detail.note.pinned ? ' · 置顶' : ''}
                  {detail.note.completed ? ' · 已完成' : ''}
                </div>
              </section>
            )}

            {kindOf(detail) === 'tag' && detail.tag && (
              <section className="trash-detail-sec">
                <div className="trash-tag-row">
                  <span className="tag-dot" style={{ background: detail.tag.color }} />
                  <span className="trash-detail-title">{detail.tag.name}</span>
                </div>
                <div className="muted">
                  颜色 {detail.tag.color} · 恢复后需重新给任务打标签
                </div>
              </section>
            )}

            {kindOf(detail) === 'task' &&
              (detail.tasks ?? []).map(({ date, task }) => (
                <section key={date} className="trash-detail-sec">
                  <div className="trash-detail-date">
                    {date}
                    <span className={'pill ' + (task.done ? 'pill--ok' : 'pill--accent')}>
                      {task.done ? '已完成' : '进行中'}
                    </span>
                  </div>
                  {task.title && <h4 className="trash-detail-title">{task.title}</h4>}
                  {task.body ? (
                    <RichView content={task.body} />
                  ) : (
                    <div className="muted">（无正文）</div>
                  )}
                  {task.subtasks.length > 0 && (
                    <ul className="trash-detail-sub">
                      {task.subtasks.map((s) => (
                        <li key={s.id} className={s.done ? 'done' : ''}>
                          {s.done ? '☑' : '☐'} {s.title}
                        </li>
                      ))}
                    </ul>
                  )}
                  {task.note && (
                    <div className="trash-detail-note">
                      <span className="muted">备注</span>
                      <p>{task.note}</p>
                    </div>
                  )}
                </section>
              ))}

            <div className="trash-detail-foot">
              <button
                className="btn btn--primary btn--sm"
                onClick={() => {
                  void restore([detail.id])
                  setDetail(null)
                }}
              >
                <RotateCcw size={14} />
                {kindOf(detail) === 'task' ? '恢复到原日期' : '恢复'}
              </button>
              <button
                className="btn btn--sm btn--danger"
                onClick={() => {
                  void remove([detail.id])
                  setDetail(null)
                }}
              >
                <Trash2 size={14} />
                永久删除
              </button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}
