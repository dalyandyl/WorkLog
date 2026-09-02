import { promises as fs } from 'fs'
import path from 'path'
import type { PublishRecord } from '../shared/types'

export interface PublishHistory {
  records: PublishRecord[]
}

export function historyPath(root: string): string {
  return path.join(root, 'publish-history.json')
}

async function readHistory(root: string): Promise<PublishHistory> {
  try {
    const raw = await fs.readFile(historyPath(root), 'utf-8')
    const data = JSON.parse(raw)
    return { records: Array.isArray(data?.records) ? data.records : [] }
  } catch {
    return { records: [] }
  }
}

async function writeHistory(root: string, h: PublishHistory): Promise<void> {
  await fs.mkdir(path.dirname(historyPath(root)), { recursive: true })
  await fs.writeFile(historyPath(root), JSON.stringify(h, null, 2), 'utf-8')
}

/** 新增发布记录（新记录排最前） */
export async function addPublishRecord(root: string, record: PublishRecord): Promise<void> {
  const h = await readHistory(root)
  h.records.unshift(record)
  await writeHistory(root, h)
}

/** 发布记录列表（最新在前） */
export async function readPublishRecords(root: string): Promise<PublishRecord[]> {
  const h = await readHistory(root)
  return h.records
}

/** 删除发布记录（不影响已发布到各天的任务） */
export async function deletePublishRecord(
  root: string,
  id: string
): Promise<{ ok: boolean }> {
  const h = await readHistory(root)
  const next = h.records.filter((r) => r.id !== id)
  if (next.length === h.records.length) return { ok: false }
  await writeHistory(root, { records: next })
  return { ok: true }
}
