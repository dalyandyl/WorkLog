import type { Subtask } from '../../types'
import { toDateStr, weekInfoOf, type PublishGranularity } from '../../utils/date'

/**
 * 任务发布模块的类型与纯逻辑工具。
 * 从原 700 行的 `TaskPublish.tsx` 拆出（见 memory-bank/07-optimization-backlog.md P2-3）。
 */

/** 「已发布任务」的默认加载窗口（天）与每次「加载更多」的步长 */
export const PUBLISH_WINDOW_DAYS = 60
export const PUBLISH_WINDOW_STEP = 60

/** 发布历史筛选粒度选项 */
export const GRANULARITY_OPTIONS: { value: PublishGranularity; label: string }[] = [
  { value: 'day', label: '按日' },
  { value: 'week', label: '按周' },
  { value: 'month', label: '按月' },
  { value: 'year', label: '按年' }
]

/** 判断某日是否落在「锚点日期」的指定粒度周期内 */
export function inPeriod(dateStr: string, anchor: string, g: PublishGranularity): boolean {
  if (g === 'day') return dateStr === anchor
  if (g === 'week') return weekInfoOf(dateStr).weekKey === weekInfoOf(anchor).weekKey
  if (g === 'month') return dateStr.slice(0, 7) === anchor.slice(0, 7)
  return dateStr.slice(0, 4) === anchor.slice(0, 4)
}

/** 粒度对应的范围说明 */
export function histRangeLabel(g: PublishGranularity, anchor: string): string {
  if (!anchor) return ''
  if (g === 'day') return `单日：${anchor}`
  if (g === 'week') {
    const wi = weekInfoOf(anchor)
    return `第 ${wi.week} 周：${wi.start} ~ ${wi.end}`
  }
  if (g === 'month') return `月度：${anchor.slice(0, 7)}`
  return `年度：${anchor.slice(0, 4)}`
}

/** 待发布任务（批量派发列表中的一项） */
export interface PendingTask {
  localId: string
  title: string
  tags: string[]
  subtasks: Subtask[]
  body: string
  rangeMode: boolean
  singleDate: string
  start: string
  end: string
}

/** 待发布草稿在 localStorage 中的键 */
export const PENDING_DRAFT_KEY = 'wl-publish-draft'

/** 新建一条空白待发布项 */
export function newPending(): PendingTask {
  const today = toDateStr(new Date())
  return {
    localId: crypto.randomUUID(),
    title: '',
    tags: [],
    subtasks: [],
    body: '',
    rangeMode: false,
    singleDate: today,
    start: today,
    end: today
  }
}

/**
 * 恢复待发布草稿。
 * 视图在切换页签时会被卸载，未持久化的草稿会直接丢失 —— 这里做持久化。
 * 解析失败或结构不符时当作没有草稿（不让脏数据影响主流程）。
 */
export function loadPendingDraft(): PendingTask[] {
  try {
    const raw = localStorage.getItem(PENDING_DRAFT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .map((p) => ({
        ...newPending(),
        ...p,
        // 关键字段做类型兜底，避免旧草稿缺字段导致渲染异常
        localId: typeof p.localId === 'string' ? p.localId : crypto.randomUUID(),
        title: typeof p.title === 'string' ? p.title : '',
        tags: Array.isArray(p.tags) ? (p.tags as string[]) : [],
        subtasks: Array.isArray(p.subtasks) ? (p.subtasks as Subtask[]) : [],
        body: typeof p.body === 'string' ? p.body : '',
        rangeMode: p.rangeMode === true
      }))
  } catch {
    return []
  }
}

/** 保存 / 清除待发布草稿（空列表即清除） */
export function savePendingDraft(pending: PendingTask[]): void {
  try {
    if (pending.length === 0) localStorage.removeItem(PENDING_DRAFT_KEY)
    else localStorage.setItem(PENDING_DRAFT_KEY, JSON.stringify(pending))
  } catch {
    // 隐私模式 / 配额不足：不影响主流程
  }
}

/** 把目标日期列表格式化为简短说明 */
export function fmtDates(dates: string[]): string {
  if (dates.length === 0) return ''
  if (dates.length === 1) return dates[0]
  return `${dates[0]} ~ ${dates[dates.length - 1]}（共 ${dates.length} 个）`
}
