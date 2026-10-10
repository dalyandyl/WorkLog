/**
 * 渲染层的日期工具。
 *
 * 真正的实现在 [`src/shared/date.ts`](../../../shared/date.ts)（主进程与渲染层共用），
 * 这里只做转发并保留渲染层原有的命名（`weekdayOf` / `weekInfoOf`），
 * 避免改动所有调用点。`PublishGranularity` 是纯 UI 概念，留在这一层。
 */
import { enumerateDates, getWeekInfo, toDateStr, weekdayName } from '../../../shared/date'

export type { WeekInfo } from '../../../shared/types'
export { enumerateDates, toDateStr }

/** 'YYYY-MM-DD' -> 星期几（中文）。与主进程 `weekdayName` 是同一个函数。 */
export const weekdayOf = weekdayName

/** 计算某日期所在 ISO 周。与主进程 `getWeekInfo` 是同一个函数。 */
export const weekInfoOf = getWeekInfo

/** 发布 / 历史筛选的粒度 */
export type PublishGranularity = 'day' | 'week' | 'month' | 'year'
