import { useState } from 'react'
import { X } from 'lucide-react'
import type { StatusReporter, Tag } from '../../types'
import DatePicker from '../DatePicker'
import MarkdownEditor from '../MarkdownEditor'
import SubtaskEditor from '../SubtaskEditor'
import TagPicker from '../TagPicker'
import type { PendingTask } from './types'

interface PendingTaskCardProps {
  value: PendingTask
  tags: Tag[]
  onChange: (patch: Partial<PendingTask>) => void
  onRemove: () => void
  onGoToTags: () => void
  onStatus: StatusReporter
}

/** 待发布条目卡片（批量派发列表中的一项，可折叠子任务与正文） */
export default function PendingTaskCard({
  value,
  tags,
  onChange,
  onRemove,
  onGoToTags,
  onStatus
}: PendingTaskCardProps) {
  const [showSubtasks, setShowSubtasks] = useState(true)
  const [showBody, setShowBody] = useState(true)

  return (
    <div className="pending-card">
      <div className="pending-card-head">
        <input
          className="publish-title"
          placeholder="任务标题"
          value={value.title}
          autoFocus
          onChange={(e) => onChange({ title: e.target.value })}
        />
        <button className="icon-btn danger" onClick={onRemove} title="移除该条" aria-label="移除该条">
          <X size={15} />
        </button>
      </div>

      <TagPicker
        selectedIds={value.tags}
        allTags={tags}
        onChange={(ids) => onChange({ tags: ids })}
        onGoToTags={onGoToTags}
      />

      <div className="publish-dates">
        <div className="publish-mode">
          <label>
            <input
              type="radio"
              checked={!value.rangeMode}
              onChange={() => onChange({ rangeMode: false })}
            />
            单日
          </label>
          <label>
            <input
              type="radio"
              checked={value.rangeMode}
              onChange={() => onChange({ rangeMode: true })}
            />
            区间
          </label>
        </div>
        {value.rangeMode ? (
          <div className="publish-range">
            <DatePicker value={value.start} onChange={(v) => onChange({ start: v })} title="起始日期" />
            <span>至</span>
            <DatePicker value={value.end} onChange={(v) => onChange({ end: v })} title="结束日期" />
          </div>
        ) : (
          <DatePicker
            value={value.singleDate}
            onChange={(v) => onChange({ singleDate: v })}
            title="发布日期"
          />
        )}
      </div>

      <div className="pending-toggles">
        <button className="ghost-btn" onClick={() => setShowSubtasks((v) => !v)}>
          子任务 {showSubtasks ? '▴' : '▾'}
        </button>
        <button className="ghost-btn" onClick={() => setShowBody((v) => !v)}>
          正文 {showBody ? '▴' : '▾'}
        </button>
      </div>
      {showSubtasks && (
        <SubtaskEditor
          subtasks={value.subtasks}
          tags={tags}
          onChange={(subs) => onChange({ subtasks: subs })}
        />
      )}
      {showBody && (
        <MarkdownEditor
          value={value.body}
          onChange={(b) => onChange({ body: b })}
          attachFolder="publish"
          onStatus={onStatus}
        />
      )}
    </div>
  )
}
