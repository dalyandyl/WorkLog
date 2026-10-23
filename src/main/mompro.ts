import { promises as fs } from 'fs'
import path from 'path'
import type { MomProFeature, MomProFeatureInput, MomProKind, MomProTableRef } from '../shared/types'

const FILE_NAME = 'mompro-features.json'

function storePath(root: string): string {
  return path.join(root, FILE_NAME)
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf-8')
  } catch {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    // 1.5.3 没有原子写：文件写坏时不能当成空数据、下一保存直接把原内容覆盖掉，先挪到旁边留个证据
    try {
      await fs.rename(file, `${file}.bad-${Date.now()}`)
    } catch {
      /* 挪不动就算了，下面的 fallback 照旧 */
    }
    return fallback
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8')
}

// 简单串行化 mompro-features.json 的读写：弹窗里连续保存/删除时避免互相覆盖
let storeLock: Promise<unknown> = Promise.resolve()

function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = storeLock.then(fn, fn)
  storeLock = run.catch(() => {})
  return run
}

const KINDS: MomProKind[] = ['form', 'transaction', 'other']

function normalizeKind(kind: unknown): MomProKind {
  return KINDS.includes(kind as MomProKind) ? (kind as MomProKind) : 'other'
}

/** 读盘容错：缺字段补默认值，脏数据里的表名一律 trim 并丢掉空行 */
function normalizeRow(row: MomProFeature): MomProFeature {
  const tables: MomProTableRef[] = Array.isArray(row.tables)
    ? row.tables
        .filter((t) => t && typeof t.name === 'string' && t.name.trim())
        .map((t) => ({
          id: t.id || crypto.randomUUID(),
          name: t.name.trim(),
          note: (t.note ?? '').trim()
        }))
    : []
  const createdAt = row.createdAt || new Date().toISOString()
  return {
    id: row.id,
    name: (row.name ?? '').trim(),
    kind: normalizeKind(row.kind),
    plugin: (row.plugin ?? '').trim(),
    logic: row.logic ?? '',
    tables,
    createdAt,
    updatedAt: row.updatedAt || createdAt
  }
}

/** 所有功能（按更新时间倒序，最近改过的在最上面） */
export function listMomProFeatures(root: string): Promise<MomProFeature[]> {
  return withStoreLock(async () => {
    const all = await readJson<MomProFeature[]>(storePath(root), [])
    const rows = (Array.isArray(all) ? all : []).map(normalizeRow)
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return rows
  })
}

/** 出现过的插件名（去重、按名称排序），给输入框做联想 */
export function listMomProPlugins(root: string): Promise<string[]> {
  return withStoreLock(async () => {
    const all = await readJson<MomProFeature[]>(storePath(root), [])
    const set = new Set<string>()
    for (const row of Array.isArray(all) ? all : []) {
      const p = (row.plugin ?? '').trim()
      if (p) set.add(p)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh'))
  })
}

function prepare(input: MomProFeatureInput): {
  name: string
  kind: MomProKind
  plugin: string
  logic: string
  tables: { name: string; note: string }[]
} {
  return {
    name: (input.name ?? '').trim(),
    kind: normalizeKind(input.kind),
    plugin: (input.plugin ?? '').trim(),
    logic: input.logic ?? '',
    tables: (input.tables ?? [])
      .map((t) => ({ name: (t.name ?? '').trim(), note: (t.note ?? '').trim() }))
      .filter((t) => t.name)
  }
}

export function createMomProFeature(
  root: string,
  input: MomProFeatureInput
): Promise<MomProFeature> {
  return withStoreLock(async () => {
    const all = await readJson<MomProFeature[]>(storePath(root), [])
    const rows = Array.isArray(all) ? all : []
    const data = prepare(input)
    const now = new Date().toISOString()
    const feature: MomProFeature = {
      id: crypto.randomUUID(),
      name: data.name,
      kind: data.kind,
      plugin: data.plugin,
      logic: data.logic,
      tables: data.tables.map((t) => ({ id: crypto.randomUUID(), name: t.name, note: t.note })),
      createdAt: now,
      updatedAt: now
    }
    rows.push(feature)
    await writeJson(storePath(root), rows)
    return feature
  })
}

/** 编辑：整份覆盖（表单是整体提交的），保留原 id / createdAt，刷新 updatedAt */
export function updateMomProFeature(
  root: string,
  id: string,
  input: MomProFeatureInput
): Promise<MomProFeature | null> {
  return withStoreLock(async () => {
    const all = await readJson<MomProFeature[]>(storePath(root), [])
    const rows = Array.isArray(all) ? all : []
    const idx = rows.findIndex((f) => f.id === id)
    if (idx === -1) return null
    const prev = rows[idx]
    const data = prepare(input)
    // 表名没改的沿用原 id，避免前端每次保存都换 key
    const prevTables = new Map(
      (Array.isArray(prev.tables) ? prev.tables : []).map((t) => [t.name.trim(), t.id])
    )
    const next: MomProFeature = {
      id: prev.id,
      name: data.name,
      kind: data.kind,
      plugin: data.plugin,
      logic: data.logic,
      tables: data.tables.map((t) => ({
        id: prevTables.get(t.name) || crypto.randomUUID(),
        name: t.name,
        note: t.note
      })),
      createdAt: prev.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    rows[idx] = next
    await writeJson(storePath(root), rows)
    return next
  })
}

/** 彻底删除（不进回收站） */
export function deleteMomProFeature(root: string, id: string): Promise<{ ok: boolean }> {
  return withStoreLock(async () => {
    const all = await readJson<MomProFeature[]>(storePath(root), [])
    const rows = Array.isArray(all) ? all : []
    const next = rows.filter((f) => f.id !== id)
    if (next.length === rows.length) return { ok: false }
    await writeJson(storePath(root), next)
    return { ok: true }
  })
}
