import { useState } from 'react'
import type { Project } from '../types'
import Modal from './Modal'

interface ProjectManagerProps {
  projects: Project[]
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

const UNCATEGORIZED_ID = 'uncategorized'

export default function ProjectManager({ projects, onChanged, onStatus }: ProjectManagerProps) {
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')

  async function add(): Promise<void> {
    const v = name.trim()
    if (!v) return
    const p = await window.api.createProject(v, color)
    if (!p) {
      setErrorMsg(`项目「${v}」已存在，请换一个名称`)
      return
    }
    setName('')
    setShowAdd(false)
    onChanged()
    onStatus('已添加项目')
  }

  function startEdit(p: Project): void {
    setEditingId(p.id)
    setEditName(p.name)
    setEditColor(p.color)
  }

  async function saveEdit(): Promise<void> {
    if (!editingId) return
    const v = editName.trim()
    if (!v) return
    const r = await window.api.renameProject(editingId, v)
    if (!r) {
      setErrorMsg(`项目「${v}」已存在，请换一个名称`)
      onChanged()
      setEditingId(null)
      return
    }
    if (editColor !== r.color) await window.api.recolorProject(editingId, editColor)
    setEditingId(null)
    onChanged()
    onStatus('已保存项目')
  }

  async function del(p: Project): Promise<void> {
    if (p.id === UNCATEGORIZED_ID) {
      setErrorMsg('「未分类」为默认项目，不可删除')
      return
    }
    if (window.confirm(`删除项目「${p.name}」？该项目下的任务将归入「未分类」。`)) {
      await window.api.deleteProject(p.id)
      onChanged()
      onStatus('已删除项目')
    }
  }

  return (
    <div className="tag-manager">
      <div className="tag-manager-head">
        <h3>项目管理</h3>
        <button className="ghost-btn" onClick={() => setShowAdd(true)}>
          ➕ 添加项目
        </button>
        <span className="muted tag-manager-tip">任务、日报、周报、统计均按项目组织</span>
      </div>

      <div className="tag-list">
        {projects.map((p) => (
          <div key={p.id} className={'tag-row' + (editingId === p.id ? ' editing' : '')}>
            <span className="tag-dot" style={{ background: editingId === p.id ? editColor : p.color }} />
            {editingId === p.id ? (
              <>
                <input
                  className="tag-name-input"
                  value={editName}
                  autoFocus
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit()
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                />
                <input
                  type="color"
                  className="tag-color-input"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                />
                <button className="icon-btn primary" onClick={saveEdit} title="保存">
                  💾
                </button>
                <button className="icon-btn" onClick={() => setEditingId(null)} title="取消">
                  ✕
                </button>
              </>
            ) : (
              <>
                <span className="tag-name-text">
                  {p.name}
                  {p.id === UNCATEGORIZED_ID && <span className="muted">（默认）</span>}
                </span>
                <span className="project-date muted">{p.createdAt.slice(0, 10)}</span>
                <button className="icon-btn" onClick={() => startEdit(p)} title="编辑">
                  ✏️
                </button>
                <button className="icon-btn danger" onClick={() => del(p)} title="删除项目">
                  🗑
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <Modal open={showAdd} title="添加项目" width={460} onClose={() => setShowAdd(false)}>
        <div className="tag-create-form">
          <label className="tag-create-label">项目名称</label>
          <input
            className="tag-create-name"
            placeholder="新项目名称"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
          />
          <label className="tag-create-label">颜色</label>
          <div className="tag-create-colors">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                className={'color-swatch' + (color === c ? ' active' : '')}
                style={{ background: c }}
                onClick={() => setColor(c)}
                title={c}
              />
            ))}
            <input
              type="color"
              className="tag-color-input"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              title="自定义颜色"
            />
          </div>
          <div className="tag-create-actions">
            <button className="tag-create-btn" onClick={add} disabled={!name.trim()}>
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
