/**
 * 中国法定节假日与调休安排（按国务院办公厅发布，随年份维护）
 * holiday: 法定放假日期 -> 节日名
 * workday: 调休上班日期（通常为周末）-> 说明
 */

interface YearHolidayData {
  holiday: Record<string, string>
  workday: Record<string, string>
}

const DATA: Record<number, YearHolidayData> = {
  2025: {
    holiday: {
      '2025-01-01': '元旦',
      '2025-01-28': '除夕',
      '2025-01-29': '初一',
      '2025-01-30': '初二',
      '2025-01-31': '初三',
      '2025-02-01': '初四',
      '2025-02-02': '初五',
      '2025-02-03': '初六',
      '2025-02-04': '初七',
      '2025-04-04': '清明节',
      '2025-04-05': '清明节',
      '2025-04-06': '清明节',
      '2025-05-01': '劳动节',
      '2025-05-02': '劳动节',
      '2025-05-03': '劳动节',
      '2025-05-04': '劳动节',
      '2025-05-05': '劳动节',
      '2025-05-31': '端午节',
      '2025-06-01': '端午节',
      '2025-06-02': '端午节',
      '2025-10-01': '国庆节',
      '2025-10-02': '国庆节',
      '2025-10-03': '国庆节',
      '2025-10-04': '国庆节',
      '2025-10-05': '国庆节',
      '2025-10-06': '中秋节',
      '2025-10-07': '国庆节',
      '2025-10-08': '国庆节'
    },
    workday: {
      '2025-01-26': '春节前补班',
      '2025-02-08': '春节后补班',
      '2025-04-27': '劳动节前补班',
      '2025-09-28': '国庆节前补班',
      '2025-10-11': '国庆节后补班'
    }
  },
  2026: {
    holiday: {
      '2026-01-01': '元旦',
      '2026-01-02': '元旦',
      '2026-01-03': '元旦',
      '2026-02-15': '春节',
      '2026-02-16': '除夕',
      '2026-02-17': '初一',
      '2026-02-18': '初二',
      '2026-02-19': '初三',
      '2026-02-20': '初四',
      '2026-02-21': '初五',
      '2026-02-22': '初六',
      '2026-02-23': '初七',
      '2026-04-04': '清明节',
      '2026-04-05': '清明节',
      '2026-04-06': '清明节',
      '2026-05-01': '劳动节',
      '2026-05-02': '劳动节',
      '2026-05-03': '劳动节',
      '2026-05-04': '劳动节',
      '2026-05-05': '劳动节',
      '2026-06-19': '端午节',
      '2026-06-20': '端午节',
      '2026-06-21': '端午节',
      '2026-09-25': '中秋节',
      '2026-09-26': '中秋节',
      '2026-09-27': '中秋节',
      '2026-10-01': '国庆节',
      '2026-10-02': '国庆节',
      '2026-10-03': '国庆节',
      '2026-10-04': '国庆节',
      '2026-10-05': '国庆节',
      '2026-10-06': '国庆节',
      '2026-10-07': '国庆节'
    },
    workday: {
      '2026-01-04': '元旦后补班',
      '2026-02-14': '春节前补班',
      '2026-02-28': '春节后补班',
      '2026-05-09': '劳动节后补班',
      '2026-09-20': '中秋节前补班',
      '2026-10-10': '国庆节后补班'
    }
  }
}

export interface DayRestInfo {
  /** 法定假日（红显）或调休上班日（周末但上班，不标红） */
  kind: 'holiday' | 'adjusted-work'
  name: string
}

/** 运行时拉取到的年份数据缓存（静态 DATA 之外的年份） */
const runtimeCache = new Map<number, YearHolidayData>()

/** 正在拉取的年份（防止并发重复请求） */
const pendingFetches = new Map<number, Promise<YearHolidayData | null>>()

/** 按需拉取某年节假日（已有静态/缓存则直接返回） */
export async function loadHolidayYear(year: number): Promise<YearHolidayData | null> {
  if (DATA[year]) return DATA[year]
  if (runtimeCache.has(year)) return runtimeCache.get(year)!
  let p = pendingFetches.get(year)
  if (!p) {
    p = window.api
      .fetchHoliday(year)
      .then((r) => {
        if (r.ok && r.holiday && r.workday) {
          const data: YearHolidayData = { holiday: r.holiday, workday: r.workday }
          runtimeCache.set(year, data)
          return data
        }
        return null
      })
      .catch(() => null)
      .finally(() => {
        pendingFetches.delete(year)
      })
    pendingFetches.set(year, p)
  }
  return p
}

/** 强制重新拉取某年节假日（清缓存后联网刷新） */
export async function refreshHolidayYear(year: number): Promise<YearHolidayData | null> {
  runtimeCache.delete(year)
  pendingFetches.delete(year)
  return loadHolidayYear(year)
}

/** 查询某日的法定节假日/调休信息；无记录返回 null */
export function holidayInfoOf(date: string): DayRestInfo | null {
  const year = Number(date.slice(0, 4))
  const data = DATA[year] ?? runtimeCache.get(year)
  if (!data) return null
  if (data.holiday[date]) return { kind: 'holiday', name: data.holiday[date] }
  if (data.workday[date]) return { kind: 'adjusted-work', name: data.workday[date] }
  return null
}

/** 该日是否为休息日（法定假日，或未被调休占用的周末） */
export function isRestDay(date: string): boolean {
  const info = holidayInfoOf(date)
  if (info?.kind === 'holiday') return true
  if (info?.kind === 'adjusted-work') return false
  const day = new Date(date + 'T00:00:00').getDay()
  return day === 0 || day === 6
}
