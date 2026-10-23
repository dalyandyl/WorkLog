import { confirmDialog } from './confirm'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { ClipboardList, Database, Pencil, Plus, Puzzle, Search, Trash2, X } from 'lucide-react'
import type { MomProFeature, MomProFeatureInput, MomProKind } from '../types'
import Modal from './Modal'
import RichView from './RichView'

// 富文本编辑器较重（TipTap + lowlight），懒加载；自带 Suspense 边界，避免整页被替换
const RichBodyEditor = lazy(() => import('./RichBodyEditor'))

const KIND_LABEL: Record<MomProKind, string> = {
  form: '表单',
  transaction: '事务',
  other: '其他'
}
const KIND_ORDER: MomProKind[] = ['form', 'transaction', 'other']
const KIND_MOD: Record<MomProKind, string> = {
  form: 'pill--accent',
  transaction: 'pill--ok',
  other: ''
}

function kindPill(kind: MomProKind): string {
  return 'pill ' + KIND_MOD[kind]
}

/** 弹窗里编辑用的草稿：表的 id 只用于前端的增删定位 */
interface DraftTable {
  id: string
  name: string
  note: string
}

interface Draft {
  name: string
  kind: MomProKind
  plugin: string
  logic: string
  tables: DraftTable[]
}

function newTable(): DraftTable {
  return { id: crypto.randomUUID(), name: '', note: '' }
}

function emptyDraft(): Draft {
  return { name: '', kind: 'form', plugin: '', logic: '', tables: [newTable()] }
}

function draftOf(f: MomProFeature): Draft {
  return {
    name: f.name,
    kind: f.kind,
    plugin: f.plugin,
    logic: f.logic,
    tables: f.tables.length
      ? f.tables.map((t) => ({ id: t.id, name: t.name, note: t.note }))
      : [newTable()]
  }
}

/** ISO -> 本地「YYYY-MM-DD HH:mm」 */
function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 搜索：名称 / 插件 / 表名 / 运行逻辑（大小写不敏感） */
function hit(f: MomProFeature, q: string): boolean {
  if (!q) return true
  const t = q.toLowerCase()
  return (
    f.name.toLowerCase().includes(t) ||
    f.plugin.toLowerCase().includes(t) ||
    f.tables.some((x) => x.name.toLowerCase().includes(t) || x.note.toLowerCase().includes(t)) ||
    f.logic.toLowerCase().includes(t)
  )
}

/** 新建 / 编辑表单（只在弹窗打开时挂载，所以用 initial 初始化 state 即可） */
function FeatureForm({
  initial,
  plugins,
  saving,
  onCancel,
  onSubmit
}: {
  initial: MomProFeature | null
  plugins: string[]
  saving: boolean
  onCancel: () => void
  onSubmit: (input: MomProFeatureInput) => void
}) {
  const [draft, setDraft] = useState<Draft>(() => (initial ? draftOf(initial) : emptyDraft()))
  const [error, setError] = useState('')

  function patch(p: Partial<Draft>): void {
    setDraft((d) => ({ ...d, ...p }))
    setError('')
  }

  function patchTable(id: string, p: Partial<DraftTable>): void {
    setDraft((d) => ({
      ...d,
      tables: d.tables.map((t) => (t.id === id ? { ...t, ...p } : t))
    }))
    setError('')
  }

  function submit(): void {
    if (!draft.name.trim()) {
      setError('请先填写功能名称')
      return
    }
    const badRow = draft.tables.findIndex((t) => !t.name.trim() && t.note.trim())
    if (badRow >= 0) {
      setError(`第 ${badRow + 1} 行填了说明但没填表名`)
      return
    }
    onSubmit({
      name: draft.name.trim(),
      kind: draft.kind,
      plugin: draft.plugin.trim(),
      logic: draft.logic,
      tables: draft.tables
        .filter((t) => t.name.trim())
        .map((t) => ({ name: t.name.trim(), note: t.note.trim() }))
    })
  }

  return (
    <div className="mpl-form">
      <div className="mpl-row">
        <label className="mpl-field mpl-field--grow">
          <span className="mpl-label">功能名称</span>
          <input
            className="input"
            autoFocus
            placeholder="例如：订单导出申请单"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>
        <label className="mpl-field">
          <span className="mpl-label">类型</span>
          <div className="seg mpl-kind-seg">
            {KIND_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                className={'seg-btn' + (draft.kind === k ? ' on' : '')}
                onClick={() => patch({ kind: k })}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </label>
      </div>

      <label className="mpl-field">
        <span className="mpl-label">所属插件</span>
        <input
          className="input"
          placeholder="插件名称，例如：订单中心 / mom_order"
          list="mpl-plugin-list"
          value={draft.plugin}
          onChange={(e) => patch({ plugin: e.target.value })}
        />
        <datalist id="mpl-plugin-list">
          {plugins.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>

      <div className="mpl-field">
        <span className="mpl-label">功能运行逻辑</span>
        <div className="mpl-logic">
          <Suspense fallback={<div className="editor-loading">编辑器加载中…</div>}>
            <RichBodyEditor
              value={draft.logic}
              onChange={(md) => patch({ logic: md })}
              attachFolder="mompro"
            />
          </Suspense>
        </div>
        <span className="mpl-hint">
          支持 Markdown 与截图粘贴；建议写清触发条件、执行步骤、异常与回滚。
        </span>
      </div>

      <div className="mpl-field">
        <span className="mpl-label">
          涉及的数据库表
          <span className="mpl-label-hint">表名 + 一句用途说明，可留空</span>
        </span>
        <div className="mpl-table-form">
          {draft.tables.map((t) => (
            <div className="mpl-table-form-row" key={t.id}>
              <input
                className="input mpl-tname"
                placeholder="表名，如 mt_form_main"
                value={t.name}
                onChange={(e) => patchTable(t.id, { name: e.target.value })}
              />
              <input
                className="input mpl-tnote"
                placeholder="这张表存什么 / 用来做什么"
                value={t.note}
                onChange={(e) => patchTable(t.id, { note: e.target.value })}
              />
              <button
                type="button"
                className="mpl-row-del"
                title="删掉这一行"
                disabled={draft.tables.length <= 1}
                onClick={() =>
                  setDraft((d) => ({ ...d, tables: d.tables.filter((x) => x.id !== t.id) }))
                }
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn--ghost btn--sm mpl-add-table"
            onClick={() => setDraft((d) => ({ ...d, tables: [...d.tables, newTable()] }))}
          >
            <Plus size={13} />
            再加一张表
          </button>
        </div>
      </div>

      {error && <div className="mpl-error">{error}</div>}

      <div className="mpl-form-actions">
        <button className="btn" onClick={onCancel} disabled={saving}>
          取消
        </button>
        <button className="btn btn--primary" onClick={submit} disabled={saving}>
          {saving ? '保存中…' : initial ? '保存修改' : '创建功能'}
        </button>
      </div>
    </div>
  )
}

export default function MomProView() {
  const [features, setFeatures] = useState<MomProFeature[]>([])
  const [plugins, setPlugins] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | MomProKind>('all')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<MomProFeature | null>(null)
  const [saving, setSaving] = useState(false)

  async function reload(): Promise<void> {
    try {
      const [list, pluginList] = await Promise.all([
        window.api.listMomProFeatures(),
        window.api.listMomProPlugins()
      ])
      setFeatures(list)
      setPlugins(pluginList)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim()
    return features.filter((f) => (kind === 'all' || f.kind === kind) && hit(f, q))
  }, [features, kind, query])

  const selected =
    filtered.find((f) => f.id === activeId) ?? (filtered.length > 0 ? filtered[0] : null)

  const stats = useMemo(() => {
    const pluginSet = new Set<string>()
    const tableSet = new Set<string>()
    for (const f of features) {
      if (f.plugin) pluginSet.add(f.plugin)
      for (const t of f.tables) tableSet.add(t.name)
    }
    return { plugins: pluginSet.size, tables: tableSet.size }
  }, [features])

  function openCreate(): void {
    setEditing(null)
    setEditorOpen(true)
  }

  function openEdit(f: MomProFeature): void {
    setEditing(f)
    setEditorOpen(true)
  }

  async function save(input: MomProFeatureInput): Promise<void> {
    setSaving(true)
    try {
      if (editing) {
        const next = await window.api.updateMomProFeature(editing.id, input)
        if (next) setActiveId(next.id)
      } else {
        const created = await window.api.createMomProFeature(input)
        setActiveId(created.id)
        // 新建后把筛选清掉，保证新条目一定在列表里露出来
        setQuery('')
        setKind('all')
      }
      setEditorOpen(false)
      setEditing(null)
      await reload()
    } finally {
      setSaving(false)
    }
  }

  async function remove(f: MomProFeature): Promise<void> {
    const ok = await confirmDialog({
      title: '删除功能？',
      message: `「${f.name}」会从台账里彻底删掉，无法恢复。`,
      okText: '删除',
      danger: true
    })
    if (!ok) return
    await window.api.deleteMomProFeature(f.id)
    if (activeId === f.id) setActiveId(null)
    await reload()
  }

  return (
    <div className="mompro-view">
      <header className="workhead">
        <div className="wh-left">
          <span className="wh-title wh-title--hero">功能台账</span>
          <span className="wh-sub">
            {features.length} 个功能 · {stats.plugins} 个插件 · {stats.tables} 张表
          </span>
        </div>
        <div className="wh-right">
          <button className="btn btn--primary btn--sm" onClick={openCreate}>
            <Plus size={14} />
            新建功能
          </button>
        </div>
      </header>

      <div className="with-side">
        <aside className="page-side mpl-side">
          <div className="mpl-search">
            <Search size={13} className="mpl-search-icon" />
            <input
              className="input mpl-search-input"
              placeholder="搜索名称 / 插件 / 表名…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="mpl-search-clear" onClick={() => setQuery('')} title="清空">
                <X size={12} />
              </button>
            )}
          </div>

          <div className="seg mpl-seg">
            <button
              className={'seg-btn' + (kind === 'all' ? ' on' : '')}
              onClick={() => setKind('all')}
            >
              全部
            </button>
            {KIND_ORDER.map((k) => (
              <button
                key={k}
                className={'seg-btn' + (kind === k ? ' on' : '')}
                onClick={() => setKind(k)}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>

          <div className="ps-head">
            <span>功能列表</span>
            <span className="ps-count">{filtered.length}</span>
          </div>

          <div className="mpl-list">
            {filtered.map((f) => (
              <button
                key={f.id}
                className={'mpl-item' + (selected?.id === f.id ? ' on' : '')}
                onClick={() => setActiveId(f.id)}
                title={f.name}
              >
                <span className="mpl-item-name">{f.name || '（未命名）'}</span>
                <span className={kindPill(f.kind) + ' mpl-item-kind'}>{KIND_LABEL[f.kind]}</span>
                <span className="mpl-item-plugin">{f.plugin || '未填插件'}</span>
                {f.tables.length > 0 && (
                  <span className="mpl-item-tables">
                    <Database size={10} />
                    {f.tables.length}
                  </span>
                )}
              </button>
            ))}
            {!loading && filtered.length === 0 && (
              <div className="mpl-list-empty">
                {features.length === 0 ? '台账还是空的' : '没有匹配的功能'}
              </div>
            )}
          </div>

          <div className="ps-hint">
            点左侧条目看详情；右上角「新建功能」录入新的表单 / 事务。
          </div>
        </aside>

        <div className="page-main">
          <div className="workscroll mpl-detail">
            {selected ? (
              <article className="mpl-detail-card">
                <header className="mpl-detail-head">
                  <div className="mpl-detail-title">
                    <h2>{selected.name}</h2>
                    <div className="mpl-detail-meta">
                      <span className={kindPill(selected.kind)}>{KIND_LABEL[selected.kind]}</span>
                      <span className="mpl-plugin-name">
                        <Puzzle size={12} />
                        {selected.plugin || '未填插件'}
                      </span>
                      <span className="mpl-updated">更新于 {when(selected.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="mpl-detail-actions">
                    <button className="btn btn--sm" onClick={() => openEdit(selected)}>
                      <Pencil size={13} />
                      编辑
                    </button>
                    <button className="btn btn--sm btn--danger" onClick={() => void remove(selected)}>
                      <Trash2 size={13} />
                      删除
                    </button>
                  </div>
                </header>

                <section className="mpl-section">
                  <h3 className="mpl-section-title">功能运行逻辑</h3>
                  {selected.logic.trim() ? (
                    <RichView content={selected.logic} />
                  ) : (
                    <p className="muted mpl-placeholder">还没有填写运行逻辑。</p>
                  )}
                </section>

                <section className="mpl-section">
                  <h3 className="mpl-section-title">
                    涉及的数据库表
                    <span className="mpl-count">{selected.tables.length}</span>
                  </h3>
                  {selected.tables.length > 0 ? (
                    <ul className="mpl-table-list">
                      {selected.tables.map((t) => (
                        <li className="mpl-table-item" key={t.id}>
                          <code className="mpl-table-name">{t.name}</code>
                          {t.note && <span className="mpl-table-note">{t.note}</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted mpl-placeholder">没有登记表。</p>
                  )}
                </section>

                <footer className="mpl-foot">创建于 {when(selected.createdAt)}</footer>
              </article>
            ) : (
              <div className="empty-state">
                <ClipboardList size={26} />
                <div>
                  {features.length === 0
                    ? '台账还是空的，点右上角「新建功能」登记第一个表单 / 事务。'
                    : '当前筛选下没有功能，换个关键词或类型试试。'}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={editorOpen}
        title={editing ? '编辑功能' : '新建功能'}
        width={780}
        onClose={() => {
          if (!saving) setEditorOpen(false)
        }}
      >
        <FeatureForm
          key={editing?.id ?? 'new'}
          initial={editing}
          plugins={plugins}
          saving={saving}
          onCancel={() => setEditorOpen(false)}
          onSubmit={(input) => void save(input)}
        />
      </Modal>
    </div>
  )
}
