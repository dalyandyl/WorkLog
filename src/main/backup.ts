import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import AdmZip from 'adm-zip'

/** 将整个日志目录（含日志、周报、附件、元数据、设置）打包为 zip */
export async function exportBackup(root: string, destZip: string): Promise<void> {
  const zip = new AdmZip()
  await addDirToZip(zip, root, '')
  zip.writeZip(destZip)
}

async function addDirToZip(zip: AdmZip, dir: string, base: string): Promise<void> {
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    const rel = base ? `${base}/${e.name}` : e.name
    if (e.isDirectory()) {
      await addDirToZip(zip, full, rel)
    } else {
      zip.addLocalFile(full, base)
    }
  }
}

/**
 * 校验 zip 内所有条目路径安全，拒绝：
 *   - 绝对路径（`/etc/x`、`C:\x`、`\\server\share`）—— 解压会写到目标目录之外；
 *   - 含 `..` 的路径段 —— 经典 zip-slip 穿越。
 * 备份 zip 可能来自 WebDAV 远端或他人分享，必须当作不可信输入。
 */
function assertSafeZipEntries(zip: AdmZip): void {
  for (const entry of zip.getEntries()) {
    const raw = String(entry.entryName ?? '')
    const name = raw.replace(/\\/g, '/')
    const isAbsolute = name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.startsWith('//')
    const hasParent = name.split('/').some((seg) => seg === '..')
    if (isAbsolute || hasParent) {
      throw new Error(`备份压缩包内含不安全的路径，已中止导入：${raw}`)
    }
  }
}

/** 从 zip 备份恢复（解压到临时目录后合并进日志目录） */
export async function importBackup(root: string, srcZip: string): Promise<void> {
  const zip = new AdmZip(srcZip)
  assertSafeZipEntries(zip)
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'worklog-import-'))
  try {
    zip.extractAllTo(tmp, true)
    await fs.mkdir(root, { recursive: true })
    await mergeDirs(tmp, root)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
}

async function mergeDirs(src: string, dest: string): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true })
  for (const e of entries) {
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) {
      await fs.mkdir(d, { recursive: true })
      await mergeDirs(s, d)
    } else {
      await fs.mkdir(path.dirname(d), { recursive: true })
      await fs.copyFile(s, d)
    }
  }
}
