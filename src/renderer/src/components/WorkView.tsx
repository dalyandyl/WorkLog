import { useState } from 'react'
import type { Tag } from '../types'
import DayView from './DayView'
import WeeklyView from './WeeklyView'

interface WorkViewProps {
  tags: Tag[]
  date: string
  weekKey: string
  daySel: { date: string; taskId: string | null }
  onDateChange: (d: string) => void
  onWeekChange: (wk: string) => void
  onSelectTask: (id: string | null) => void
  onTasksChanged: () => void
  onStatus: (msg: string) => void
}

/** 日报 / 周报 切换容器 */
export default function WorkView({
  tags,
  date,
  weekKey,
  daySel,
  onDateChange,
  onWeekChange,
  onSelectTask,
  onTasksChanged,
  onStatus
}: WorkViewProps) {
  const [tab, setTab] = useState<'day' | 'week'>('day')

  return (
    <div className="project-view">
      <div className="project-view-tabs">
        <button
          className={tab === 'day' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setTab('day')}
        >
          日报
        </button>
        <button
          className={tab === 'week' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setTab('week')}
        >
          周报
        </button>
      </div>
      <div className="project-view-body">
        {tab === 'day' ? (
          <DayView
            date={date}
            tags={tags}
            selectedTaskId={daySel.date === date ? daySel.taskId : null}
            onSelectTask={(id) => onSelectTask(id)}
            onDateChange={onDateChange}
            onTasksChanged={onTasksChanged}
            onStatus={onStatus}
            onGoToTags={() => {}}
          />
        ) : (
          <WeeklyView
            weekKey={weekKey}
            tags={tags}
            onWeekChange={onWeekChange}
            onStatus={onStatus}
          />
        )}
      </div>
    </div>
  )
}
