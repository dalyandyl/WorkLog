import { promises as fs } from 'fs'
import path from 'path'
import type { Meeting } from '../shared/types'
import { readJson, writeJson, withDataLock } from './jsonStore'
import { attachmentsDir } from './attachments'
import { meetingFileName, meetingsDir } from './paths'

/**
 * 会议附件的通用存储目录（复用 attachments 模块与 wlattach:// 协议）。
 * 走 attachmentsDir 的净化 + 越界校验，避免渲染层传入的 id 造成目录穿越。
 */
export function meetingAttachmentsDir(storageRoot: string, meetingId: string): string {
  return attachmentsDir(storageRoot, `meetings/${meetingId}`)
}

function normalize(m: Meeting): Meeting {
  m.attachments = m.attachments ?? []
  m.tags = m.tags ?? []
  return m
}

export async function listMeetings(storageRoot: string): Promise<Meeting[]> {
  const dir = meetingsDir(storageRoot)
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const meetings: Meeting[] = []
  for (const f of files) {
    if (!f.endsWith('.md.json')) continue
    // readJson 会把损坏文件隔离备份并发告警，而不是静默丢弃
    const m = await readJson<Meeting | null>(path.join(dir, f), null)
    if (m && typeof m === 'object' && m.id) meetings.push(normalize(m))
  }
  // 按会议日期倒序，日期相同按创建时间倒序
  meetings.sort((a, b) => {
    if (a.date !== b.date) return a.date > b.date ? -1 : 1
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  })
  return meetings
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

/**
 * 清理旧版本按「日期_时间_标题」命名的同名会议文件。
 *
 * 性能：只在**规范文件名尚不存在**时才扫描目录 —— 这对应"升级后第一次保存该会议"。
 * 之后每次保存都能跳过整目录解析（旧实现每次保存都遍历并解析所有会议文件）。
 */
async function cleanupLegacyFiles(dir: string, meeting: Meeting): Promise<void> {
  const canonical = path.join(dir, meetingFileName(meeting.id))
  if (await fileExists(canonical)) return
  let files: string[] = []
  try {
    files = await fs.readdir(dir)
  } catch {
    return
  }
  for (const f of files) {
    if (!f.endsWith('.md.json') || f === meetingFileName(meeting.id)) continue
    const m = await readJson<Meeting | null>(path.join(dir, f), null)
    if (m && m.id === meeting.id) {
      await fs.rm(path.join(dir, f), { force: true })
    }
  }
}

export async function saveMeeting(storageRoot: string, meeting: Meeting): Promise<void> {
  await withDataLock(async () => {
    const dir = meetingsDir(storageRoot)
    await fs.mkdir(dir, { recursive: true })
    meeting.updatedAt = new Date().toISOString()
    await cleanupLegacyFiles(dir, meeting)
    await writeJson(path.join(dir, meetingFileName(meeting.id)), meeting)
  })
}

export async function deleteMeeting(storageRoot: string, id: string): Promise<void> {
  const dir = meetingsDir(storageRoot)
  await withDataLock(async () => {
    // 常见路径：规范文件名直接删除（一次 unlink，不扫描目录）
    const canonical = path.join(dir, meetingFileName(id))
    if (await fileExists(canonical)) {
      await fs.rm(canonical, { force: true })
    } else {
      // 回退：旧命名文件，需要扫描目录按 id 匹配
      let files: string[] = []
      try {
        files = await fs.readdir(dir)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
      for (const f of files) {
        if (!f.endsWith('.md.json')) continue
        const m = await readJson<Meeting | null>(path.join(dir, f), null)
        if (m && m.id === id) {
          await fs.rm(path.join(dir, f), { force: true })
          break
        }
      }
    }
  })
  // 删除该会议的附件目录（统一存放在 <root>/attachments/meetings/<id>）
  await fs.rm(meetingAttachmentsDir(storageRoot, id), { recursive: true, force: true })
}
