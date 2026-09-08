import { useEffect, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import type { TrashItem } from '../types'

interface TrashViewProps {
  onStatus: (msg: string) => void
  onRestored: () => void
}

export default function TrashView({ onStatus, onRestored }: TrashViewProps) {
  const [items, setItems] = useState<TrashItem[]>([])

  function refresh(): void {
    window.api.listTrash().then(setItems)
  }

  useEffect(() => {
    refresh()
  }, [])

  async function restore(item: TrashItem): Promise<void> {
    const r = await window.api.restoreTrash(item.id)
    if (r.ok) {
      onStatus('已恢复')
      onRestored()
      refresh()
    }
  }

  async function remove(item: TrashItem): Promise<void> {
    if (window.confirm(`永久删除「${item.title}」？此操作不可恢复。`)) {
      await window.api.removeTrash(item.id)
      onStatus('已永久删除')
      refresh()
    }
  }

  async function clear(): Promise<void> {
    if (window.confirm('清空回收站？所有条目将被永久删除，不可恢复。')) {
      await window.api.clearTrash()
      onStatus('已清空回收站')
      refresh()
    }
  }

  return (
    <div className="publish-view">
      <div className="date-heading">
        <h2>临时回收站</h2>
        <span className="weekday">删除的发布任务先保留在此，可恢复或永久删除</span>
        {items.length > 0 && (
          <button className="ghost-btn" onClick={clear}>
            清空回收站
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="task-empty">回收站为空</div>
      ) : (
        <div className="publish-history">
          {items.map((item) => (
            <div key={item.id} className="publish-record">
              <div className="publish-record-main">
                <span className="publish-record-title">{item.title}</span>
                <span className="publish-record-meta">
                  {item.tasks.length} 个任务实例 · {item.tasks[0]?.date ?? ''}
                  {item.tasks.length > 1 ? ` ~ ${item.tasks[item.tasks.length - 1]?.date ?? ''}` : ''}
                </span>
                <span className="publish-record-time">
                  删除于 {new Date(item.deletedAt).toLocaleString()}
                </span>
              </div>
              <div className="publish-record-actions">
                <button className="ghost-btn" onClick={() => restore(item)} title="恢复到原日期">
                  <RotateCcw size={14} />
                  恢复
                </button>
                <button className="icon-btn danger" onClick={() => remove(item)} title="永久删除">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
