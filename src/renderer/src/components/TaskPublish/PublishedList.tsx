import { CalendarClock } from 'lucide-react'
import type { Tag, Task } from '../../types'
import TagBadgeList from '../TagBadge'
import { PUBLISH_WINDOW_STEP } from './types'

/** 已发布任务列表中的一条（某天的一个任务副本） */
export interface PublishedEntry {
  date: string
  task: Task
}

interface PublishedListProps {
  published: PublishedEntry[]
  /** 当前加载窗口（天） */
  pubWindow: number
  /** 有任务的总天数，用于提示"只显示了窗口内的部分" */
  pubTotalDays: number
  tagMap: Map<string, Tag>
  onOpen: (entry: PublishedEntry) => void
  onPostpone: (entry: PublishedEntry) => void
  onToggleDone: (entry: PublishedEntry) => void
  onLoadMore: () => void
}

/**
 * 「已发布任务」只读列表。
 *
 * 只渲染传入窗口内的条目（窗口由父组件按时间切分），
 * 因此数据量增长时这里不会一次性把全部历史挂到 DOM 上。
 */
export default function PublishedList({
  published,
  pubWindow,
  pubTotalDays,
  tagMap,
  onOpen,
  onPostpone,
  onToggleDone,
  onLoadMore
}: PublishedListProps) {
  if (published.length === 0) {
    return (
      <div className="published-list">
        <div className="task-empty">暂无已发布任务</div>
      </div>
    )
  }

  return (
    <div className="published-list">
      {pubTotalDays > pubWindow && (
        <div className="published-window-hint">
          仅显示最近 {pubWindow} 天（共有 {pubTotalDays} 天存在任务）
        </div>
      )}
      {published.map((entry) => (
        <div
          key={entry.task.id + entry.date}
          className={'publish-record' + (entry.task.done ? ' done' : '')}
          onClick={() => onOpen(entry)}
          title="点击查看详情"
        >
          <div className="publish-record-main">
            <span className="publish-record-title">{entry.task.title || '（未命名）'}</span>
            <span className="publish-record-meta">
              {entry.date} · 派发 {new Date(entry.task.publishedAt).toLocaleString()}
            </span>
            {entry.task.completedAt && (
              <span className="publish-record-time">
                完成于 {new Date(entry.task.completedAt).toLocaleString()}
              </span>
            )}
          </div>
          <div className="publish-record-tags">
            <TagBadgeList ids={entry.task.tags} tagMap={tagMap} />
          </div>
          <div className="publish-record-actions" onClick={(e) => e.stopPropagation()}>
            {!entry.task.done && (
              <button
                className="icon-btn"
                onClick={() => onPostpone(entry)}
                title="延期（追加自定义区间，所有天同步）"
              >
                <CalendarClock size={15} />
              </button>
            )}
            <input
              type="checkbox"
              className="task-check"
              checked={entry.task.done}
              onChange={() => onToggleDone(entry)}
              title="勾选完成"
            />
          </div>
        </div>
      ))}
      {pubTotalDays > 0 && (
        <button className="ghost-btn published-load-more" onClick={onLoadMore}>
          加载更多（再往前 {PUBLISH_WINDOW_STEP} 天）
        </button>
      )}
    </div>
  )
}
