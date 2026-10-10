import { promises as fs } from 'fs'
import path from 'path'
import type { DataWarning, DataWarningKind } from '../shared/types'

export type { DataWarning, DataWarningKind }

/**
 * 数据层公共设施：**原子写** + **不静默的读失败** + **写串行化**。
 *
 * 背景（改造前的问题，见 memory-bank/07-optimization-backlog.md P0-2 / P0-3）：
 *   1. 所有写入都是 `fs.writeFile` 直接覆盖原文件 —— 进程崩溃/断电会留下截断的 JSON；
 *   2. 所有读取都是 `try { ... } catch { return [] }` —— 截断的 JSON 被当成"当天没有任务"，
 *      紧接着的下一次写入就把真实数据**永久覆盖**，且用户毫无感知。
 *
 * 现在：
 *   - 写入走「临时文件 + rename」，rename 是原子的，不会出现半个文件；
 *   - 读取区分「文件不存在」（正常空态）与「解析失败」（数据损坏）：
 *     损坏时把原文件**改名隔离**为 `<file>.corrupt-<时间戳>` 保留证据，再返回空值，
 *     同时通过告警回调把问题抛给界面 —— 数据永远不会被悄悄丢掉；
 *   - 所有写操作经 `withDataLock` 串行化，消除 read-modify-write 丢更新。
 */

let warningHandler: ((w: DataWarning) => void) | null = null

/** 由主进程入口注入：把数据层告警转发到渲染层（Toast 提示） */
export function setDataWarningHandler(fn: ((w: DataWarning) => void) | null): void {
  warningHandler = fn
}

function emitWarning(w: DataWarning): void {
  console.error(`[data] ${w.kind}: ${w.file} — ${w.message}`)
  try {
    warningHandler?.(w)
  } catch (err) {
    console.error('[data] 告警回调自身出错:', err)
  }
}

/** 供其它数据层模块上报自定义告警（例如回收站超限清理） */
export function reportDataWarning(w: DataWarning): void {
  emitWarning(w)
}

/** 判断错误是否为"文件不存在"（正常空态，不该报错） */
function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
}

/** 隔离损坏文件用的时间戳后缀（不含冒号，Windows 文件名安全） */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/**
 * 读取 JSON 文件。
 *
 * - 文件不存在 → 返回 `fallback`（正常空态，静默）
 * - 内容不是合法 JSON / 读取出错 → 隔离损坏文件 + 发出告警，再返回 `fallback`
 * - 其它 IO 错误（如权限）→ 抛出，由 IPC 层转成用户可见的错误
 */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf-8')
  } catch (err) {
    if (isNotFound(err)) return fallback
    throw err
  }
  // 空文件（例如写入过程中被强杀留下的 0 字节文件）同样按损坏处理
  if (raw.trim() === '') {
    const quarantine = await quarantineCorrupt(file)
    emitWarning({
      kind: 'corrupt',
      file,
      message: `数据文件为空，已隔离备份，本次按空数据继续`,
      quarantine
    })
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    const quarantine = await quarantineCorrupt(file)
    emitWarning({
      kind: 'corrupt',
      file,
      message: `数据文件解析失败（可能被截断），已隔离备份以免被覆盖，本次按空数据继续`,
      quarantine
    })
    return fallback
  }
}

/**
 * 把损坏文件改名隔离，返回隔离后的路径。
 * 改名而不是复制，是为了让原路径"消失"——后续写入会创建全新文件，
 * 绝不会覆盖仍未修复的损坏内容。
 */
async function quarantineCorrupt(file: string): Promise<string | undefined> {
  const target = `${file}.corrupt-${stamp()}`
  try {
    await fs.rename(file, target)
    return target
  } catch (err) {
    console.error('[data] 隔离损坏文件失败:', file, err)
    return undefined
  }
}

/**
 * 原子写入 JSON：先写同目录下的临时文件，再 rename 覆盖目标。
 * 同分区 rename 是原子操作，因此任何时刻磁盘上要么是旧内容、要么是新内容，
 * 不会出现被截断的半个文件。
 */
export async function writeJson(file: string, data: unknown): Promise<void> {
  const text = JSON.stringify(data, null, 2)
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true })
  const tmp = `${file}.tmp-${process.pid.toString(36)}-${Date.now().toString(36)}`
  try {
    await fs.writeFile(tmp, text, 'utf-8')
    await fs.rename(tmp, file)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {
      /* 清理失败无所谓 */
    })
    emitWarning({ kind: 'write-failed', file, message: `写入失败：${String(err)}` })
    throw err
  }
}

/** 删除数据文件（内容为空时的语义，例如某天任务被清空） */
export async function removeFile(file: string): Promise<void> {
  await fs.rm(file, { force: true })
}

// ==================== 写串行化 ====================

/**
 * 全局写锁的等待链。
 *
 * 为什么用一个"全局"锁而不是按文件/任务 id 分锁：本应用是**单用户桌面程序**，
 * 所有写操作都是短促的本地文件 IO；一个全局串行锁就能彻底消除
 * read-modify-write 丢更新，且不会形成多把锁之间的死锁。
 * 真正需要并发优化的场景（跨天批量写）由 P1-1 的索引/缓存层解决，
 * 而不是靠放宽一致性。若将来 profiling 显示锁竞争明显，再细化为按键分锁。
 */
let writeChain: Promise<void> = Promise.resolve()

/** 串行执行一个写事务；前一个事务失败不会阻塞后续事务 */
export function withDataLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn)
  writeChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/**
 * 「读 - 改 - 写」事务：在读改写全程持有写锁，并使用严格读取与原子写入。
 * 所有需要"先读出来、改完再写回"的地方都应使用它，而不是自己 readFile/writeFile。
 */
export async function updateJson<T>(
  file: string,
  fallback: T,
  mutate: (current: T) => T | Promise<T>
): Promise<T> {
  return withDataLock(async () => {
    const current = await readJson<T>(file, fallback)
    const next = await mutate(current)
    await writeJson(file, next)
    return next
  })
}
