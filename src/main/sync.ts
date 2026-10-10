import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { net } from 'electron'
import type { WebdavConfig } from '../shared/types'
import { exportBackup, importBackup } from './backup'
import { resetMigration } from './migrate'

function authHeader(cfg: WebdavConfig): string {
  return 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')
}

function fileUrl(cfg: WebdavConfig): string {
  return cfg.url.replace(/\/+$/, '') + '/worklog-logs.zip'
}

/**
 * 扫描日志目录内所有文件的最近修改时间（用于冲突提示）。
 *
 * ⚠️ 必须**递归**。原先只扫「根文件 + 一层子目录」，于是：
 *   - `journal/<年>/<日期>.json`（第三层）里改一条日志**根本不会被发现**；
 *   - `attachments/meetings/<id>/x.png`（第四层）同理。
 * 后果是「本地明明改了，同步时不提示冲突」→ 静默覆盖对方的改动。
 * 深度上限 4 层足以覆盖现有全部布局，同时避免异常目录结构把递归拖深。
 */
export async function lastDataMtime(root: string, maxDepth = 4): Promise<number> {
  let max = 0

  async function walk(dir: string, level: number): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (!entries) return
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (level < maxDepth) await walk(full, level + 1)
        continue
      }
      try {
        const st = await fs.stat(full)
        if (st.mtimeMs > max) max = st.mtimeMs
      } catch {
        /* 单个文件 stat 失败不影响整体 */
      }
    }
  }

  await walk(root, 0)
  return max
}

/** 将本地日志目录打包上传到 WebDAV（覆盖远端 worklog-logs.zip） */
export async function webdavPush(
  root: string,
  cfg: WebdavConfig
): Promise<{ ok: boolean; error?: string }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'worklog-push-'))
  const zipPath = path.join(tmp, 'logs.zip')
  try {
    await exportBackup(root, zipPath)
    const buf = await fs.readFile(zipPath)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    const res = await net.fetch(fileUrl(cfg), {
      method: 'PUT',
      headers: { Authorization: authHeader(cfg), 'Content-Type': 'application/zip' },
      body: ab
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

/** 从 WebDAV 下载日志压缩包并合并进本地日志目录 */
export async function webdavPull(
  root: string,
  cfg: WebdavConfig
): Promise<{ ok: boolean; error?: string }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'worklog-pull-'))
  const zipPath = path.join(tmp, 'logs.zip')
  try {
    const res = await net.fetch(fileUrl(cfg), { headers: { Authorization: authHeader(cfg) } })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const buf = Buffer.from(await res.arrayBuffer())
    await fs.writeFile(zipPath, buf)
    await importBackup(root, zipPath)
    await resetMigration(root) // 拉取旧备份后重新执行迁移
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}
