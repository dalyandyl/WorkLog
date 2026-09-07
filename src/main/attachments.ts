import { promises as fs } from 'fs'
import path from 'path'

/** 附件目录：<root>/attachments/<folder>/ */
export function attachmentsDir(root: string, folder: string): string {
  return path.join(root, 'attachments', folder)
}

/** 清理文件名中的路径分隔符与保留字符，防止路径穿越 */
export function sanitizeName(name: string): string {
  const base = path.basename(name).replace(/[\\/:*?"<>|]/g, '_').trim()
  return base || 'file'
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
  const safe = uniqueName(name)
  const dir = attachmentsDir(root, folder)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, safe)
  await fs.writeFile(file, Buffer.from(buf))
  return { url: toAttachmentUrl(folder, safe), file }
}

/** 从磁盘复制文件作为附件（文件选择对话框选中的文件） */
export async function importAttachmentFile(
  root: string,
  folder: string,
  srcPath: string
): Promise<{ url: string; file: string }> {
  const safe = uniqueName(path.basename(srcPath))
  const dir = attachmentsDir(root, folder)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, safe)
  await fs.copyFile(srcPath, file)
  return { url: toAttachmentUrl(folder, safe), file }
}

/** 把 wlattach:// URL 解析为磁盘路径（仅允许落在 attachments 目录内） */
export function attachmentUrlToPath(root: string, url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'wlattach:') return null
    const rel = decodeURIComponent(u.hostname + u.pathname).replace(/^\/+/, '')
    const full = path.resolve(root, rel)
    const base = path.join(root, 'attachments') + path.sep
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
