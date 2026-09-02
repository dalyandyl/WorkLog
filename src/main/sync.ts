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

/** 扫描日志目录内所有文件的最近修改时间（用于冲突提示） */
export async function lastDataMtime(root: string): Promise<number> {
  let max = 0
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(root, e.name)
      if (e.isDirectory()) {
        const subs = await fs.readdir(full, { withFileTypes: true })
        for (const f of subs) {
          try {
            const st = await fs.stat(path.join(full, f.name))
            if (st.mtimeMs > max) max = st.mtimeMs
          } catch {
            /* ignore */
          }
        }
      } else {
        try {
          const st = await fs.stat(full)
          if (st.mtimeMs > max) max = st.mtimeMs
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
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
