import { useRef } from 'react'

interface MarkdownEditorProps {
  value: string
  onChange: (markdown: string) => void
  attachFolder: string
  placeholder?: string
  onStatus?: (msg: string) => void
}

/**
 * 纯 Markdown 源码编辑器：直接手写 Markdown 语法，无格式工具栏。
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

  return (
    <div className="md-editor">
      <div className="md-editor-bar">
        <button className="md-mini-btn" onClick={() => imageInputRef.current?.click()} title="插入图片（支持多选/粘贴/拖拽）">
          🖼 图片
        </button>
        <button className="md-mini-btn" onClick={() => void pickAttachments()} title="插入附件（支持多选）">
          📎 附件
        </button>
        <span className="md-editor-hint">支持 Markdown 语法：**加粗** ~~删除~~ # 标题 · 代码块 · 列表</span>
      </div>
      <textarea
        ref={taRef}
        className="md-textarea"
        value={value}
        placeholder={placeholder ?? '在此输入 Markdown 正文…'}
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
        onDrop={onDrop}
      />
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
