import { useEffect, useRef, useState } from 'react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { Highlight } from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Image } from '@tiptap/extension-image'
import {
  FolderOpen,
  Highlighter,
  Image as ImageIcon,
  Paperclip,
  Save,
  TextQuote,
  Trash2
} from 'lucide-react'
import type { AttachmentMeta, Meeting, Tag } from '../types'
import TagPicker from './TagPicker'
import DatePicker from './DatePicker'

const lowlight = createLowlight(common)

interface MeetingEditorProps {
  tags: Tag[]
  meeting?: Meeting | null
  onSave: (meeting: Meeting) => void
  onClose: () => void
  onStatus?: (msg: string) => void
}

/**
 * 会议编辑器：新建 / 编辑已有会议；富文本（TipTap）；
 * 附件（粘贴/拖拽图片 + 文件选择器）。UI 与其他新建界面保持一致。
 */
export default function MeetingEditor({ tags, meeting, onSave, onClose, onStatus }: MeetingEditorProps) {
  // 新建时也先生成一个固定 id，保证附件目录稳定
  const editingIdRef = useRef(meeting?.id ?? crypto.randomUUID())
  const [date, setDate] = useState(meeting?.date ?? new Date().toISOString().slice(0, 10))
  const [title, setTitle] = useState(meeting?.title ?? '')
  const [selectedTags, setSelectedTags] = useState<string[]>(meeting?.tags ?? [])
  // body 存储 TipTap 编辑器产出的 HTML
  const [bodyHtml, setBodyHtml] = useState(meeting?.body || '<p>开始编辑会议纪要...</p>')
  const [attachments, setAttachments] = useState<AttachmentMeta[]>(meeting?.attachments ?? [])

  const editorContainerRef = useRef<HTMLDivElement>(null)
  const editorInstanceRef = useRef<Editor | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  // ---- TipTap 编辑器初始化（仅在挂载时执行一次） ----
  useEffect(() => {
    if (!editorContainerRef.current || editorInstanceRef.current) return
    try {
      editorInstanceRef.current = new Editor({
        element: editorContainerRef.current,
        extensions: [
          // StarterKit v3 已内置 加粗/斜体/下划线/删除线/链接/标题/列表/引用/代码 等
          // 这里关闭内置 codeBlock，改用带语法高亮的 CodeBlockLowlight，避免扩展重名冲突
          StarterKit.configure({ codeBlock: false }),
          Table.configure({ resizable: true }),
          TableCell.extend({ content: 'block+' }),
          TableHeader.extend({ content: 'block+' }),
          TableRow,
          CodeBlockLowlight.configure({ lowlight }),
          Highlight,
          TextStyle,
          Color,
          Image.configure({ allowBase64: false })
        ],
        content: bodyHtml,
        onUpdate: ({ editor }) => {
          setBodyHtml(editor.getHTML())
        }
      })
    } catch (err) {
      console.error('Failed to initialize TipTap:', err)
    }

    return () => {
      editorInstanceRef.current?.destroy()
      editorInstanceRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- 附件上传（最新实现通过 ref 供挂载期事件监听调用） ----
  async function uploadImages(files: File[]): Promise<void> {
    for (const f of files) {
      try {
        const buf = await f.arrayBuffer()
        const url = await window.api.saveMeetingAttachment(editingIdRef.current, f.name, buf)
        setAttachments((prev) => [
          ...prev,
          { id: crypto.randomUUID(), name: f.name, url, type: 'image' }
        ])
        insertHtml(`<img src="${url}" alt="${f.name}" />`)
      } catch (err) {
        console.error('upload image failed:', err)
        onStatus?.('图片上传失败：' + f.name)
      }
    }
  }

  const uploadImagesRef = useRef<(files: File[]) => Promise<void>>(async () => {})
  uploadImagesRef.current = uploadImages

  async function pickAttachments(): Promise<void> {
    const r = await window.api.pickAttachmentFiles(`meetings/${editingIdRef.current}`)
    if (!r.ok || !r.files || r.files.length === 0) {
      if (!r.canceled && r.error) onStatus?.('附件添加失败：' + r.error)
      return
    }
    const links = r.files.map((f) => `<a href="${f.url}">📎 ${f.name}</a>`).join(' ')
    setAttachments((prev) => [
      ...prev,
      ...r.files!.map((f) => ({ id: crypto.randomUUID(), name: f.name, url: f.url, type: 'file' as const }))
    ])
    insertHtml(links + ' ')
    onStatus?.(`已添加 ${r.files.length} 个附件`)
  }

  function removeAttachment(att: AttachmentMeta): void {
    setAttachments((prev) => prev.filter((a) => a.id !== att.id))
    void window.api.deleteAttachment(att.url)
    // 同时从正文移除对应引用（<img> 或 <a>）
    const editor = editorInstanceRef.current
    if (!editor) return
    const escaped = att.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    let html = editor.getHTML()
    html = html
      .replace(new RegExp(`<img[^>]*src=["']${escaped}["'][^>]*>`, 'g'), '')
      .replace(new RegExp(`<a[^>]*href=["']${escaped}["'][^>]*>.*?<\\/a>`, 'g'), '')
    editor.chain().focus().setContent(html, { emitUpdate: false }).run()
    setBodyHtml(html)
  }

  // ---- 编辑器粘贴 / 拖拽图片（捕获阶段拦截，避免 ProseMirror 重复处理） ----
  useEffect(() => {
    const el = editorContainerRef.current
    if (!el) return
    function onPasteCapture(e: ClipboardEvent): void {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith('image/')
      )
      if (files.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      void uploadImagesRef.current(files)
    }
    function onDropCapture(e: DragEvent): void {
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
        f.type.startsWith('image/')
      )
      if (files.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      void uploadImagesRef.current(files)
    }
    el.addEventListener('paste', onPasteCapture, true)
    el.addEventListener('drop', onDropCapture, true)
    return () => {
      el.removeEventListener('paste', onPasteCapture, true)
      el.removeEventListener('drop', onDropCapture, true)
    }
  }, [])

  function insertHtml(html: string): void {
    editorInstanceRef.current?.chain().focus().insertContent(html).run()
  }

  // ---- 保存 ----
  function save(): void {
    if (!title.trim()) {
      onStatus?.('请填写会议标题')
      return
    }
    const now = new Date().toISOString()
    const data: Meeting = {
      id: editingIdRef.current,
      title: title.trim(),
      date,
      tags: [...selectedTags],
      body: editorInstanceRef.current ? editorInstanceRef.current.getHTML() : bodyHtml,
      attachments,
      createdAt: meeting?.createdAt ?? now,
      updatedAt: now
    }
    window.api.saveMeeting(data).then((r: { ok: boolean }) => {
      if (r.ok) {
        onSave(data)
        onClose()
      } else {
        onStatus?.('保存失败')
      }
    })
  }

  // ---- 工具栏动作 ----
  function toggleBold(): void {
    editorInstanceRef.current?.chain().focus().toggleBold().run()
  }
  function toggleItalic(): void {
    editorInstanceRef.current?.chain().focus().toggleItalic().run()
  }
  function toggleUnderline(): void {
    editorInstanceRef.current?.chain().focus().toggleUnderline().run()
  }
  function toggleStrike(): void {
    editorInstanceRef.current?.chain().focus().toggleStrike().run()
  }
  function toggleHighlight(): void {
    editorInstanceRef.current?.chain().focus().toggleHighlight().run()
  }
  function setHeading(level: 1 | 2 | 3): void {
    editorInstanceRef.current?.chain().focus().toggleHeading({ level }).run()
  }
  function toggleBulletList(): void {
    editorInstanceRef.current?.chain().focus().toggleBulletList().run()
  }
  function toggleOrderedList(): void {
    editorInstanceRef.current?.chain().focus().toggleOrderedList().run()
  }
  function toggleBlockquote(): void {
    editorInstanceRef.current?.chain().focus().toggleBlockquote().run()
  }
  function insertTable(): void {
    editorInstanceRef.current?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  }
  function insertCodeBlock(): void {
    editorInstanceRef.current?.chain().focus().setCodeBlock({ language: 'js' }).run()
  }

  return (
    <div className="meeting-editor">
      {/* 标题 */}
      <input
        className="meeting-title-input"
        placeholder="会议标题"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
      />

      {/* 标签（与其他界面一致的标准标签选择器） */}
      <TagPicker selectedIds={selectedTags} allTags={tags} onChange={setSelectedTags} />

      {/* 日期 */}
      <div className="meeting-meta-bar">
        <div className="meta-group">
          <label>日期</label>
          <DatePicker value={date} onChange={setDate} title="选择会议日期" />
        </div>
      </div>

      {/* 富文本编辑器 */}
      <div className="editor-wrapper">
        <div className="editor-toolbar">
          <button className="toolbar-btn" onClick={toggleBold} title="加粗"><b>B</b></button>
          <button className="toolbar-btn" onClick={toggleItalic} title="斜体"><i>I</i></button>
          <button className="toolbar-btn" onClick={toggleUnderline} title="下划线"><u>U</u></button>
          <button className="toolbar-btn" onClick={toggleStrike} title="删除线"><s>S</s></button>
          <button className="toolbar-btn" onClick={toggleHighlight} title="高亮"><Highlighter size={15} /></button>
          <span className="toolbar-divider" />
          <button className="toolbar-btn" onClick={() => setHeading(1)} title="标题 1">H1</button>
          <button className="toolbar-btn" onClick={() => setHeading(2)} title="标题 2">H2</button>
          <button className="toolbar-btn" onClick={() => setHeading(3)} title="标题 3">H3</button>
          <span className="toolbar-divider" />
          <button className="toolbar-btn" onClick={toggleBulletList} title="无序列表">•</button>
          <button className="toolbar-btn" onClick={toggleOrderedList} title="有序列表">1.</button>
          <button className="toolbar-btn" onClick={toggleBlockquote} title="引用"><TextQuote size={15} /></button>
          <button className="toolbar-btn" onClick={insertTable} title="插入表格">⊞</button>
          <button className="toolbar-btn" onClick={insertCodeBlock} title="代码块">&lt;/&gt;</button>
          <button className="toolbar-btn" onClick={() => imageInputRef.current?.click()} title="插入图片"><ImageIcon size={15} /></button>
        </div>
        <div ref={editorContainerRef} className="rich-editor-content" />
      </div>

      {/* 附件区 */}
      <div className="meeting-attach-bar">
        <span className="attach-label">附件</span>
        <button className="md-mini-btn" onClick={() => imageInputRef.current?.click()}>
          <ImageIcon size={14} />
          图片
        </button>
        <button className="md-mini-btn" onClick={() => void pickAttachments()}>
          <Paperclip size={14} />
          文件
        </button>
        <span className="attach-hint">支持粘贴 / 拖拽图片</span>
      </div>
      {attachments.length > 0 && (
        <div className="meeting-attach-list">
          {attachments.map((a) => (
            <div key={a.id} className="meeting-attach-item">
              <span className="attach-icon">
                {a.type === 'image' ? <ImageIcon size={14} /> : <Paperclip size={14} />}
              </span>
              <span className="attach-name" title={a.name}>{a.name}</span>
              <button
                className="icon-btn"
                title="打开附件"
                onClick={() => void window.api.openAttachment(a.url)}
              >
                <FolderOpen size={15} />
              </button>
              <button className="icon-btn danger" title="删除附件" onClick={() => removeAttachment(a)}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 底部操作 */}
      <div className="meeting-actions">
        <button className="action-btn cancel-btn" onClick={onClose}>取消</button>
        <button className="action-btn save-btn" onClick={save}><Save size={14} /> 保存</button>
      </div>

      {/* 隐藏的图片文件选择 */}
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
