import { promises as fs } from 'fs'
import type { Task } from '../shared/types'
import { dayFilePath } from './paths'
import { readJson } from './jsonStore'

/**
 * 天文件读取缓存 + 「任务 → 出现日期」索引。
 *
 * 解决的问题（见 memory-bank/07-optimization-backlog.md P1-1 / P1-6）：
 * 改造前每一次任务编辑都走 `datesOfTask` = 遍历所有年份目录 + **逐个读文件并 JSON.parse**，
 * 复杂度 O(总天数)；几年数据后会明显卡顿，而且 `updateTask` 还会对命中日期重复解析一遍。
 *
 * 现在的策略：
 *   1. **天文件缓存**：以 `mtimeMs + size` 作为有效性判据。文件没变就直接复用已解析结果，
 *      省掉全部 `readFile + JSON.parse`（只留一次 `stat`）；
 *   2. **任务→日期索引**：一次全量扫描建立 `Map<taskId, Set<date>>`，之后由各写路径
 *      **增量维护**（发布 / 延期 / 删除 / 恢复时调用 index* 函数），查询变成 O(1)；
 *   3. 索引缺失（进程刚启动）时惰性构建；索引里查不到的 id 会**回退全库扫描**并回填，
 *      因此正确性不依赖"索引一定完整"这一假设。
 *
 * 外部改动（导入备份 / WebDAV 拉取 / 用户手工改文件）后必须调用 `resetTaskCache()`。
 */

interface DayEntry {
  mtimeMs: number
  size: number
  /** 天文件里的原始任务数组（未排序、未补默认值） */
  raw: Task[]
}

const dayCache = new Map<string, DayEntry>()

/** 任务 id → 出现日期集合 */
let taskDates: Map<string, Set<string>> | null = null

/** 建立索引期间正在进行的 Promise，避免并发重复全量扫描 */
let indexing: Promise<Map<string, Set<string>>> | null = null

// ==================== 失效与维护 ====================

/** 清空全部缓存与索引（外部改动数据后调用） */
export function resetTaskCache(): void {
  dayCache.clear()
  taskDates = null
  indexing = null
}

/** 某天文件被写入后调用：丢掉该天的解析缓存 */
export function invalidateDay(root: string, date: string): void {
  dayCache.delete(dayFilePath(root, date))
}

/** 登记任务出现在某些日期（发布 / 延期 / 恢复时调用） */
export function indexAddTask(taskId: string, dates: string[]): void {
  if (!taskDates) return // 索引未建立，无需维护
  let set = taskDates.get(taskId)
  if (!set) {
    set = new Set<string>()
    taskDates.set(taskId, set)
  }
  for (const d of dates) set.add(d)
}

/** 移除任务的索引（删除任务时调用）；不传 dates 表示整条移除 */
export function indexRemoveTask(taskId: string, dates?: string[]): void {
  if (!taskDates) return
  if (!dates) {
    taskDates.delete(taskId)
    return
  }
  const set = taskDates.get(taskId)
  if (!set) return
  for (const d of dates) set.delete(d)
  if (set.size === 0) taskDates.delete(taskId)
}

/** 索引中记录的日期；索引未建立时返回 null */
export function indexLookup(taskId: string): string[] | null {
  if (!taskDates) return null
  const set = taskDates.get(taskId)
  return set ? [...set].sort() : null
}

// ==================== 读取 ====================

/**
 * 读取某天文件的原始任务数组（带 mtime 缓存）。
 * 返回的数组**不应被调用方修改**（缓存共享引用）。
 * 解析失败由 jsonStore 负责隔离损坏文件并发告警。
 */
export async function readDayFileRaw(root: string, date: string): Promise<Task[]> {
  const file = dayFilePath(root, date)
  let mtimeMs: number
  let size: number
  try {
    const s = await fs.stat(file)
    mtimeMs = s.mtimeMs
    size = s.size
  } catch {
    dayCache.delete(file)
    return []
  }
  const hit = dayCache.get(file)
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) {
    return hit.raw
  }
  const parsed = await readJson<{ tasks?: Task[] }>(file, { tasks: [] })
  const raw = Array.isArray(parsed?.tasks) ? parsed.tasks : []
  // 重新取一次 stat：若刚发生损坏隔离，文件已不存在，此时不缓存
  try {
    const s2 = await fs.stat(file)
    dayCache.set(file, { mtimeMs: s2.mtimeMs, size: s2.size, raw })
  } catch {
    dayCache.delete(file)
  }
  return raw
}

// ==================== 索引构建 ====================

/**
 * 确保「任务 → 日期」索引可用；缺失时做一次全量扫描
 * （借助天文件缓存，通常只需 stat 而不必重新解析）。
 */
export async function ensureTaskDates(
  root: string,
  listDates: () => Promise<string[]>
): Promise<Map<string, Set<string>>> {
  if (taskDates) return taskDates
  if (indexing) return indexing
  indexing = (async () => {
    const dates = await listDates()
    const map = new Map<string, Set<string>>()
    for (const d of dates) {
      const raw = await readDayFileRaw(root, d)
      for (const t of raw) {
        let set = map.get(t.id)
        if (!set) {
          set = new Set<string>()
          map.set(t.id, set)
        }
        set.add(d)
      }
    }
    taskDates = map
    return map
  })()
  return indexing
}
