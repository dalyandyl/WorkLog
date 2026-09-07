import { promises as fs } from 'fs'
import path from 'path'
import type { Meeting } from '../shared/types'

const MEETINGS_DIR = 'meetings'

/** 存储文件统一按会议 id 命名，避免标题/时间变化产生重复文件 */
function meetingFileName(m: Meeting): string {
  return `${m.id}.md.json`
}

function meetingsDir(storageRoot: string): string {
  return path.join(storageRoot, MEETINGS_DIR)
}

/** 会议附件的通用存储目录（复用 attachments 模块与 wlattach:// 协议） */
export function meetingAttachmentsDir(storageRoot: string, meetingId: string): string {
  return path.join(storageRoot, 'attachments', 'meetings', meetingId)
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
    try {
      const content = await fs.readFile(path.join(dir, f), 'utf-8')
      const m = JSON.parse(content) as Meeting
      meetings.push(normalize(m))
    } catch (err) {
      console.error(`Failed to read meeting file ${f}:`, err)
    }
  }
  // 按会议日期倒序，日期相同按创建时间倒序
  meetings.sort((a, b) => {
    if (a.date !== b.date) return a.date > b.date ? -1 : 1
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  })
  return meetings
}

export async function saveMeeting(storageRoot: string, meeting: Meeting): Promise<void> {
  const dir = meetingsDir(storageRoot)
  await fs.mkdir(dir, { recursive: true })
  meeting.updatedAt = new Date().toISOString()
  const filePath = path.join(dir, meetingFileName(meeting))
  // 兼容旧版本按「日期_时间_标题」命名的文件：保存时清除同 id 的旧文件，避免同一会议重复
  let files: string[] = []
  try {
    files = await fs.readdir(dir)
  } catch {
    /* 目录刚创建 */
  }
  for (const f of files) {
    if (f === meetingFileName(meeting)) continue
    if (!f.endsWith('.md.json')) continue
    try {
      const content = await fs.readFile(path.join(dir, f), 'utf-8')
      const m = JSON.parse(content) as Meeting
      if (m.id === meeting.id) await fs.unlink(path.join(dir, f))
    } catch {
      /* 忽略坏文件 */
    }
  }
  await fs.writeFile(filePath, JSON.stringify(meeting, null, 2), 'utf-8')
}

export async function deleteMeeting(storageRoot: string, id: string): Promise<void> {
  const dir = meetingsDir(storageRoot)
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  for (const f of files) {
    if (!f.endsWith('.md.json')) continue
    try {
      const content = await fs.readFile(path.join(dir, f), 'utf-8')
      const m = JSON.parse(content) as Meeting
      if (m.id !== id) continue
      await fs.unlink(path.join(dir, f))
      break
    } catch (err) {
      console.error(`Failed to read meeting file ${f}:`, err)
    }
  }
  // 删除该会议的附件目录（统一存放在 <root>/attachments/meetings/<id>）
  await fs.rm(meetingAttachmentsDir(storageRoot, id), { recursive: true, force: true })
}
