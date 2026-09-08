import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, Paperclip } from 'lucide-react'

interface MarkdownEditorProps {
  value: string
  onChange: (markdown: string) => void
  attachFolder: string
  placeholder?: string
  onStatus?: (msg: string) => void
}

/**
 * 纯 Markdown 源码编辑器：直接手写 Markdown 语法，无格式工具栏。
 * 右键菜单支持：加粗 / 删除线 / 代码块 / 无序列表 / 有序列表；
 * 仅保留「图片 / 附件」两个上传按钮，同时支持粘贴/拖拽图片。
 */
export default function MarkdownEditor({
  value,
  onChange,
  attachFolder,
  placeholder,
  onStatus
}: MarkdownEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent): void {
      const target = e.target as Node
      if (target instanceof Element && target.closest('.md-ctx-menu')) return
      setMenu(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function insertAtCursor(text: string): void {
    const ta = taRef.current
    if (!ta) {
      onChange(value + text)
      return
    }
    const start = ta.selectionStart ?? value.length
    const end = ta.selectionEnd ?? value.length
    const next = value.slice(0, start) + text + value.slice(end)
    onChange(next)
    // 恢复光标到插入内容之后
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + text.length
      ta.setSelectionRange(pos, pos)
    })
  }

  async function uploadImages(files: File[]): Promise<void> {
    if (files.length === 0) return
    for (const f of files) {
      try {
        const buf = await f.arrayBuffer()
        const url = await window.api.saveAttachmentImage(attachFolder, f.name, buf)
        insertAtCursor(`![](${url})\n`)
      } catch (err) {
        console.error('upload image failed:', err)
        onStatus?.('图片上传失败：' + f.name)
      }
    }
  }

  async function pickAttachments(): Promise<void> {
    const r = await window.api.pickAttachmentFiles(attachFolder)
    if (!r.ok || !r.files || r.files.length === 0) {
      if (!r.canceled && r.error) onStatus?.('附件添加失败：' + r.error)
      return
    }
    const links = r.files.map((f) => `[📎 ${f.name}](${f.url})`).join(' ')
    insertAtCursor(links + ' ')
    onStatus?.(`已插入 ${r.files.length} 个附件`)
  }

  function onPaste(e: React.ClipboardEvent): void {
    const files = Array.from(e.clipboardData.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) return
    e.preventDefault()
    void uploadImages(files)
  }

  function onDrop(e: React.DragEvent): void {
    const files = Array.from(e.dataTransfer.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) return
    e.preventDefault()
    void uploadImages(files)
  }

  function onContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  /** 用前后缀包裹选中文字；未选中时插入占位并把光标放在中间 */
  function applyFormat(prefix: string, suffix: string, placeholderText: string): void {
    const ta = taRef.current
    if (!ta) return
    const start = ta.selectionStart ?? 0
    const end = ta.selectionEnd ?? start
    const selected = value.slice(start, end)
    let text: string
    let selStart: number
    let selEnd: number
    if (selected) {
      text = prefix + selected + suffix
      selStart = start
      selEnd = start + text.length
    } else {
      text = prefix + placeholderText + suffix
      selStart = start + prefix.length
      selEnd = selStart + placeholderText.length
    }
    const next = value.slice(0, start) + text + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(selStart, selEnd)
    })
    setMenu(null)
  }

  /** 把选中文字转成列表项；未选中时插入一个列表项 */
  function applyList(ordered: boolean): void {
    const ta = taRef.current
    if (!ta) return
    const start = ta.selectionStart ?? 0
    const end = ta.selectionEnd ?? start
    const selected = value.slice(start, end)
    const marker = ordered ? '1. ' : '- '
    let text: string
    if (selected) {
      text = selected
        .split('\n')
        .map((line) => marker + line)
        .join('\n')
    } else {
      text = marker + '列表项'
    }
    const next = value.slice(0, start) + text + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + text.length
      ta.setSelectionRange(pos, pos)
    })
    setMenu(null)
  }

  return (
    <div className="md-editor">
      <div className="md-editor-bar">
        <button className="md-mini-btn" onClick={() => imageInputRef.current?.click()} title="插入图片（支持多选/粘贴/拖拽）">
          <ImageIcon size={14} />
          图片
        </button>
        <button className="md-mini-btn" onClick={() => void pickAttachments()} title="插入附件（支持多选）">
          <Paperclip size={14} />
          附件
        </button>
        <span className="md-editor-hint">支持 Markdown 语法：**加粗** ~~删除~~ # 标题 · 代码块 · 列表（右键可快速插入）</span>
      </div>
      <textarea
        ref={taRef}
        className="md-textarea"
        value={value}
        placeholder={placeholder ?? '在此输入 Markdown 正文…'}
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
        onDrop={onDrop}
        onContextMenu={onContextMenu}
      />
      {menu && (
        <div
          className="md-ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button className="md-ctx-item" onClick={() => applyFormat('**', '**', '加粗文字')}>
            加粗
          </button>
          <button className="md-ctx-item" onClick={() => applyFormat('~~', '~~', '删除线文字')}>
            删除线
          </button>
          <button
            className="md-ctx-item"
            onClick={() => applyFormat('```\n', '\n```', '在此输入代码…')}
          >
            插入代码块
          </button>
          <div className="md-ctx-divider" />
          <button className="md-ctx-item" onClick={() => applyList(false)}>
            无序列表
          </button>
          <button className="md-ctx-item" onClick={() => applyList(true)}>
            有序列表
          </button>
        </div>
      )}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          void uploadImages(files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
