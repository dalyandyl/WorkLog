import type { PublishRecord } from '../shared/types'
import { readJson, writeJson, withDataLock } from './jsonStore'
import { historyPath } from './paths'

export interface PublishHistory {
  records: PublishRecord[]
}

export { historyPath }

async function readHistory(root: string): Promise<PublishHistory> {
  const data = await readJson<PublishHistory>(historyPath(root), { records: [] })
  return { records: Array.isArray(data?.records) ? data.records : [] }
}

async function writeHistory(root: string, h: PublishHistory): Promise<void> {
  await writeJson(historyPath(root), h)
}

/** 新增发布记录（新记录排最前） */
export async function addPublishRecord(root: string, record: PublishRecord): Promise<void> {
  await withDataLock(async () => {
    const h = await readHistory(root)
    h.records.unshift(record)
    await writeHistory(root, h)
  })
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
  return withDataLock(async () => {
    const h = await readHistory(root)
    const next = h.records.filter((r) => r.id !== id)
    if (next.length === h.records.length) return { ok: false }
    await writeHistory(root, { records: next })
    return { ok: true }
  })
}
