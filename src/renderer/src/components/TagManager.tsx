import { useEffect, useState } from 'react'
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import type { Tag } from '../types'
import Modal from './Modal'

interface TagManagerProps {
  tags: Tag[]
  onChanged: () => void
  onStatus: (msg: string) => void
}

const PRESET_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
  '#f97316',
  '#64748b'
]

function TagRow({
  tag,
  onRename,
  onRecolor,
  onDelete
}: {
  tag: Tag
  onRename: (id: string, name: string) => void
  onRecolor: (id: string, color: string) => void
  onDelete: (id: string, name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(tag.name)
  const [color, setColor] = useState(tag.color)

  useEffect(() => {
    setName(tag.name)
    setColor(tag.color)
  }, [tag.id, tag.name, tag.color])

  function save(): void {
    const v = name.trim()
    if (v && v !== tag.name) onRename(tag.id, v)
    if (color !== tag.color) onRecolor(tag.id, color)
    setEditing(false)
  }

  function cancel(): void {
    setName(tag.name)
    setColor(tag.color)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="tag-row editing">
        <span className="tag-dot" style={{ background: color }} />
        <input
          className="tag-name-input"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') cancel()
          }}
        />
        <input
          type="color"
          className="tag-color-input"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          title="修改颜色"
        />
        <button className="icon-btn primary" onClick={save} title="保存">
          <Save size={15} />
        </button>
        <button className="icon-btn" onClick={cancel} title="取消">
          <X size={15} />
        </button>
      </div>
    )
  }

  return (
    <div className="tag-row">
      <span className="tag-dot" style={{ background: tag.color }} />
      <span className="tag-name-text">{tag.name}</span>
      <span className="tag-use-info muted">
        使用 {tag.useCount ?? 0} 次 · 创建于 {tag.createdAt.slice(0, 10)}
      </span>
      <button className="icon-btn" onClick={() => setEditing(true)} title="编辑">
        <Pencil size={15} />
      </button>
      <button className="icon-btn danger" onClick={() => onDelete(tag.id, tag.name)} title="删除标签">
        <Trash2 size={15} />
      </button>
    </div>
  )
}

export default function TagManager({ tags, onChanged, onStatus }: TagManagerProps) {
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PRESET_COLORS[0])
  const [query, setQuery] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const filteredTags = query.trim()
    ? tags.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()))
    : tags

  async function add(): Promise<void> {
    const v = newName.trim()
    if (!v) return
    const tag = await window.api.createTag(v, newColor)
    if (!tag) {
      setErrorMsg(`标签「${v}」已存在，请换一个名称`)
      return
    }
    setNewName('')
    setShowAdd(false)
    onChanged()
    onStatus('已添加标签')
  }

  async function rename(id: string, name: string): Promise<void> {
    const tag = await window.api.renameTag(id, name)
    if (!tag) {
      setErrorMsg(`标签「${name}」已存在，请换一个名称`)
      onChanged() // 恢复显示原名
      return
    }
    onChanged()
    onStatus('已重命名标签')
  }

  async function recolor(id: string, color: string): Promise<void> {
    await window.api.recolorTag(id, color)
    onChanged()
  }

  async function del(id: string, name: string): Promise<void> {
    if (window.confirm(`删除标签「${name}」？所有任务上的该标签将被移除。`)) {
      await window.api.deleteTag(id)
      onChanged()
      onStatus('已删除标签')
    }
  }

  return (
    <div className="tag-manager">
      <div className="tag-manager-head">
        <h3>标签管理</h3>
        <button className="ghost-btn" onClick={() => setShowAdd(true)}>
          <Plus size={14} />
          添加标签
        </button>
      </div>

      <input
        className="tag-search"
        placeholder="搜索标签…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="tag-list">
        {filteredTags.length === 0 ? (
          <div className="task-empty">
            {query.trim() ? '没有匹配的标签' : '暂无标签，点击上方「添加标签」创建一个'}
          </div>
        ) : (
          filteredTags.map((t) => (
            <TagRow key={t.id} tag={t} onRename={rename} onRecolor={recolor} onDelete={del} />
          ))
        )}
      </div>

      <Modal open={showAdd} title="添加标签" width={460} onClose={() => setShowAdd(false)}>
        <div className="tag-create-form">
          <label className="tag-create-label">标签名称</label>
          <input
            className="tag-create-name"
            placeholder="新标签名称"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
          />
          <label className="tag-create-label">颜色</label>
          <div className="tag-create-colors">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                className={'color-swatch' + (newColor === c ? ' active' : '')}
                style={{ background: c }}
                onClick={() => setNewColor(c)}
                title={c}
              />
            ))}
            <input
              type="color"
              className="tag-color-input"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              title="自定义颜色"
            />
          </div>
          <div className="tag-create-actions">
            <button className="tag-create-btn" onClick={add} disabled={!newName.trim()}>
              添加
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={errorMsg !== null} title="提示" width={380} onClose={() => setErrorMsg(null)}>
        <div className="tag-error-msg">{errorMsg}</div>
        <div className="tag-create-actions">
          <button className="tag-create-btn" onClick={() => setErrorMsg(null)}>
            知道了
          </button>
        </div>
      </Modal>
    </div>
  )
}
