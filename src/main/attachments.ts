import { promises as fs } from 'fs'
import path from 'path'
import { attachmentsRoot } from './paths'

/**
 * 附件子目录名净化。
 *
 * 渲染层可以传任意字符串作为 folder（`attach:saveImage` 的 folder 直通主进程），
 * 因此这里必须当作不可信输入处理：
 *   - 丢弃 `.` / `..` / 空段 —— 彻底消除路径穿越（读取侧 attachmentUrlToPath 也做前缀校验，两侧对称）；
 *   - 替换 Windows 保留字符与路径分隔符；
 *   - 合法形态保持不变：`publish`、`2026-W36`、`meetings/<uuid>`。
 */
export function sanitizeFolder(folder: string): string {
  const parts = String(folder ?? '')
    .split(/[\\/]+/)
    .map((s) => s.trim().replace(/[:*?"<>|]/g, '_'))
    .filter((s) => s.length > 0 && s !== '.' && s !== '..')
  return parts.length > 0 ? parts.join('/') : 'misc'
}

/** Windows 保留设备名：同名文件无法创建/访问 */
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
/** 单个文件名长度上限（Windows 255 字节，中文按 UTF-8 最多 3 字节/字，留足余量） */
const MAX_NAME_LENGTH = 120

/**
 * 清理文件名：去路径分隔符与保留字符、控制字符、`..`、Windows 保留设备名，
 * 并限制长度（保留扩展名）。防路径穿越与"写不进去"两类问题。
 */
export function sanitizeName(name: string): string {
  let base = path
    .basename(String(name ?? ''))
    .replace(/[\\/:*?"<>|]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
  if (base === '.' || base === '..') base = ''

  // CON / NUL / COM1 … 加前缀规避
  const ext = path.extname(base)
  const stem = ext ? base.slice(0, -ext.length) : base
  if (RESERVED_DEVICE.test(stem)) base = '_' + base

  // 超长则截断（保留扩展名）
  if (base.length > MAX_NAME_LENGTH) {
    const e = path.extname(base)
    const keep = Math.max(1, MAX_NAME_LENGTH - e.length)
    base = base.slice(0, keep) + e
  }
  // 结尾的点/空格在 Windows 上会被静默丢弃，统一去掉
  base = base.replace(/[. ]+$/, '')
  return base || 'file'
}

/** 附件目录（已做穿越防护）：<root>/attachments/<folder>/ */
export function attachmentsDir(root: string, folder: string): string {
  const base = path.resolve(attachmentsRoot(root))
  const dir = path.resolve(base, sanitizeFolder(folder))
  // 双保险：即使净化逻辑出现漏洞，resolve + 前缀比较也拦住越界路径
  if (dir === base) return path.join(base, 'misc')
  return dir.startsWith(base + path.sep) ? dir : path.join(base, 'misc')
}

/** 生成时间戳前缀的唯一文件名 */
function uniqueName(name: string): string {
  return `${Date.now()}_${sanitizeName(name)}`
}

function toAttachmentUrl(folder: string, safeName: string): string {
  return `wlattach://attachments/${folder}/${encodeURIComponent(safeName)}`
}

/** 保存图片（来自编辑器粘贴/拖拽/上传的二进制） */
export async function saveAttachmentBuffer(
  root: string,
  folder: string,
  name: string,
  buf: ArrayBuffer
): Promise<{ url: string; file: string }> {
  const safeFolder = sanitizeFolder(folder)
  const safe = uniqueName(name)
  const dir = attachmentsDir(root, safeFolder)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, safe)
  await fs.writeFile(file, Buffer.from(buf))
  return { url: toAttachmentUrl(safeFolder, safe), file }
}

/** 从磁盘复制文件作为附件（文件选择对话框选中的文件） */
export async function importAttachmentFile(
  root: string,
  folder: string,
  srcPath: string
): Promise<{ url: string; file: string }> {
  const safeFolder = sanitizeFolder(folder)
  const safe = uniqueName(path.basename(srcPath))
  const dir = attachmentsDir(root, safeFolder)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, safe)
  await fs.copyFile(srcPath, file)
  return { url: toAttachmentUrl(safeFolder, safe), file }
}

/** 把 wlattach:// URL 解析为磁盘路径（仅允许落在 attachments 目录内） */
export function attachmentUrlToPath(root: string, url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'wlattach:') return null
    const rel = decodeURIComponent(u.hostname + u.pathname).replace(/^\/+/, '')
    const full = path.resolve(root, rel)
    const base = attachmentsRoot(root) + path.sep
    if (!full.startsWith(base)) return null
    return full
  } catch {
    return null
  }
}

/** 删除附件文件（仅允许落在 attachments 目录内） */
export async function deleteAttachmentFile(root: string, url: string): Promise<boolean> {
  const filePath = attachmentUrlToPath(root, url)
  if (!filePath) return false
  try {
    await fs.unlink(filePath)
    return true
  } catch {
    return false
  }
}
