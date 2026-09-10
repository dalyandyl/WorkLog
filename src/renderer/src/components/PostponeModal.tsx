import { useEffect, useState } from 'react'
import { CalendarClock, CalendarDays, CheckCircle2 } from 'lucide-react'
import type { Task } from '../types'
import Modal from './Modal'
import DatePicker from './DatePicker'
import { enumerateDates, toDateStr } from '../utils/date'

interface PostponeModalProps {
  open: boolean
  /** 需要延期的任务（取 id / title；done 的任务不应进入） */
  task: Task | null
  /** 任务所在的一个日期（作为 IPC 锚点） */
  entryDate: string
  onClose: () => void
  /** 延期成功后的回调（传入实际新增的天数） */
  onPostponed: (added: number) => void
  onStatus: (msg: string) => void
}

/**
 * 任务延期弹窗：在原发布区间基础上追加自定义新区间。
 * 默认「今天 ~ 今天+原区间长度-1」，可手动改起止；与已有日期重叠的部分自动跳过。
 * 确认延期后弹出「延期成功」结果弹窗。
 */
export default function PostponeModal({
  open,
  task,
  entryDate,
  onClose,
  onPostponed,
  onStatus
}: PostponeModalProps) {
  const [existingDates, setExistingDates] = useState<string[]>([])
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  // 延期成功后的结果（非 null 时展示成功弹窗）
  const [result, setResult] = useState<{ msg: string; added: number } | null>(null)

  useEffect(() => {
    if (!open || !task) return
    let cancelled = false
    window.api.datesOfTask(task.id).then((dates) => {
      if (cancelled) return
      const sorted = [...dates].sort()
      setExistingDates(sorted)
      const len = Math.max(1, sorted.length)
      const s = toDateStr(new Date())
      const e = new Date(s + 'T00:00:00')
      e.setDate(e.getDate() + len - 1)
      setStart(s)
      setEnd(toDateStr(e))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id])

  // 打开弹窗 / 切换任务时清空上一次的延期结果
  useEffect(() => {
    setResult(null)
  }, [open, task?.id])

  function rangeInfo(): string {
    if (existingDates.length === 0) return '正在读取当前区间…'
    if (existingDates.length === 1) return `当前出现在 ${existingDates[0]}（单日）`
    return `当前出现在 ${existingDates[0]} ~ ${existingDates[existingDates.length - 1]}（共 ${existingDates.length} 天）`
  }

  async function confirm(): Promise<void> {
    if (!task) return
    if (!start || !end || end < start) {
      onStatus('结束日期不能早于开始日期')
      return
    }
    const dates = enumerateDates(start, end)
    if (dates.length === 0) {
      onStatus('没有可延期的日期')
      return
    }
    const r = await window.api.postponeTask(entryDate, task.id, dates)
    if (!r.ok) {
      onStatus('延期失败：任务不存在或已完成')
      return
    }
    const skipped = dates.length - r.added
    const msg =
      `已将「${task.title || '未命名任务'}」延期至 ${start} ~ ${end}，新增 ${r.added} 天` +
      (skipped > 0 ? `；${skipped} 天已在原区间中自动跳过` : '') +
      '。原区间与新区间的所有日期都会同步显示。'
    setResult({ msg, added: r.added })
  }

  function finishPostpone(): void {
    const r = result
    setResult(null)
    onClose()
    if (r) onPostponed(r.added)
  }

  if (result !== null) {
    return (
      <Modal open={open} title="延期成功" width={480} onClose={finishPostpone}>
        <div className="postpone-result">
          <span className="postpone-result-icon">
            <CheckCircle2 size={30} />
          </span>
          <p className="postpone-result-msg">{result.msg}</p>
          <div className="postpone-actions">
            <button className="publish-btn" onClick={finishPostpone}>
              确定
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={open} title="延期任务" width={720} onClose={onClose}>
      <div className="postpone-body">
        <p className="postpone-task-title">{task?.title || '（未命名）'}</p>
        <div className="postpone-info">
          <CalendarDays size={13} />
          {rangeInfo()}
        </div>
        <p className="postpone-hint">
          延期会把该任务追加显示到新区间的每一天，原区间保留；任一天标记完成即全局完成（所有日期同步）。与已有日期重叠的部分会自动跳过。
        </p>
        <div className="postpone-range">
          <DatePicker value={start} onChange={setStart} title="延期起始日期" portal />
          <span>至</span>
          <DatePicker value={end} onChange={setEnd} title="延期结束日期" portal />
        </div>
        <div className="postpone-actions">
          <button className="ghost-btn" onClick={onClose}>
            取消
          </button>
          <button className="publish-btn" onClick={() => void confirm()}>
            <CalendarClock size={14} />
            确认延期
          </button>
        </div>
      </div>
    </Modal>
  )
}
