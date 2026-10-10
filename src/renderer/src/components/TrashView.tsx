import { useEffect, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import type { StatusReporter, TrashItem } from '../types'

interface TrashViewProps {
  onStatus: StatusReporter
  onRestored: () => void
  /** 数据变更版本号：变化时重新拉取回收站列表 */
  dataVersion?: number
}

export default function TrashView({ onStatus, onRestored, dataVersion = 0 }: TrashViewProps) {
  const [items, setItems] = useState<TrashItem[]>([])

  function refresh(): void {
    window.api.listTrash().then(setItems)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion])

  async function restore(item: TrashItem): Promise<void> {
    // 恢复失败也要给反馈：旧实现只在 r.ok 时提示，失败时「点了没反应」
    const r = await window.api.restoreTrash(item.id)
    if (r.ok) {
      onStatus('已恢复', 'success')
      onRestored()
      refresh()
    } else {
      onStatus('恢复失败', 'error')
    }
  }

  async function remove(item: TrashItem): Promise<void> {
    if (window.confirm(`永久删除「${item.title}」？此操作不可恢复。`)) {
      const r = await window.api.removeTrash(item.id)
      if (r.ok) onStatus('已永久删除', 'success')
      else onStatus('删除失败', 'error')
      refresh()
    }
  }

  async function clear(): Promise<void> {
    if (window.confirm('清空回收站？所有条目将被永久删除，不可恢复。')) {
      await window.api.clearTrash()
      onStatus('已清空回收站', 'success')
      refresh()
    }
  }

  /** 条目描述：日志与任务实例的展示口径不同 */
  function describe(item: TrashItem): string {
    if (item.journal) return `日志 · ${item.journal.date}`
    const n = item.tasks.length
    return `${n} 个任务实例 · ${item.tasks[0]?.date ?? ''}${
      n > 1 ? ` ~ ${item.tasks[n - 1]?.date ?? ''}` : ''
    }`
  }

  return (
    <div className="publish-view">
      <div className="date-heading">
        <h2>临时回收站</h2>
        <span className="weekday">删除的任务与日志条目先保留在此，可恢复或永久删除</span>
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
                <span className="publish-record-meta">{describe(item)}</span>
                <span className="publish-record-time">
                  删除于 {new Date(item.deletedAt).toLocaleString()}
                </span>
              </div>
              <div className="publish-record-actions">
                <button className="ghost-btn" onClick={() => restore(item)} title="恢复到原日期" aria-label="恢复到原日期">
                  <RotateCcw size={14} />
                  恢复
                </button>
                <button className="icon-btn danger" onClick={() => remove(item)} title="永久删除" aria-label="永久删除">
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
