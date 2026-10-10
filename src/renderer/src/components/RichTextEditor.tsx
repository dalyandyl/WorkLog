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
import { FolderOpen, Highlighter, Image as ImageIcon, Paperclip, TextQuote, Trash2 } from 'lucide-react'
import type { AttachmentMeta, StatusReporter } from '../types'

const lowlight = createLowlight(common)

/**
 * 共享富文本编辑器（TipTap）。
 *
 * 会议纪要与日志条目**共用同一个装配**，避免出现第三份 TipTap 配置各自漂移。
 * 本组件只负责「编辑 + 附件」，不包含标题/标签/日期/保存按钮等业务外壳 —— 那些留在各自的页面里。
 *
 * 类名刻意与改造前的 `MeetingEditor` 完全一致（`editor-wrapper` / `editor-toolbar` /
 * `rich-editor-content` / `meeting-attach-*` 等），因此 **main.css 无需任何改动**。
 *
 * ⚠️ 编辑器实例**只在挂载时创建一次**（`initialHtml` 只取首次值）。
 * 若父组件需要在切换条目时换内容，请用 `key` 让本组件重新挂载，而不是改 `initialHtml`。
 */
export interface RichTextEditorProps {
  /** 初始 HTML（仅挂载时生效一次） */
  initialHtml: string
  /** 附件存放的子目录，例如 `meetings/<id>` 或 `journal/<date>` */
  attachFolder: string
  /** 已存附件列表（受控） */
  attachments: AttachmentMeta[]
  onAttachmentsChange: (next: AttachmentMeta[]) => void
  /** 内容变化回调，参数是最新 HTML */
  onChange?: (html: string) => void
  /** 父组件持有的编辑器实例引用（保存时取 `getHTML()`、插入内容等） */
  editorRef?: React.MutableRefObject<Editor | null>
  onStatus?: StatusReporter
  /** 是否渲染附件工具条与附件列表；默认 true */
  showAttachments?: boolean
}

export default function RichTextEditor({
  initialHtml,
  attachFolder,
  attachments,
  onAttachmentsChange,
  onChange,
  editorRef,
  onStatus,
  showAttachments = true
}: RichTextEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const localEditorRef = useRef<Editor | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  // 工具栏按钮在编辑器就绪前不应报错
  const [, setReady] = useState(false)

  /** 供事件监听与工具栏使用的当前实例（优先外部 ref） */
  function current(): Editor | null {
    return editorRef ? editorRef.current : localEditorRef.current
  }

  // ---- 初始化（仅一次） ----
  useEffect(() => {
    if (!containerRef.current || localEditorRef.current) return
    try {
      const instance = new Editor({
        element: containerRef.current,
        extensions: [
          // StarterKit v3 已内置 加粗/斜体/下划线/删除线/链接/标题/列表/引用/代码 等；
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
        content: initialHtml,
        onUpdate: ({ editor }) => {
          onChange?.(editor.getHTML())
        }
      })
      localEditorRef.current = instance
      if (editorRef) editorRef.current = instance
      setReady(true)
    } catch (err) {
      console.error('Failed to initialize TipTap:', err)
    }

    return () => {
      localEditorRef.current?.destroy()
      localEditorRef.current = null
      if (editorRef) editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function insertHtml(html: string): void {
    current()?.chain().focus().insertContent(html).run()
  }

  // ---- 图片上传（走通用附件通道，folder 决定落盘位置） ----
  //
  // ⚠️ 一次可能来多个文件（多选 / 拖入多张）。`attachments` 是 props，闭包里不会变，
  // 所以必须**先在本地累积**、循环结束后一次性回传；否则连续调用
  // `onAttachmentsChange([...attachments, 新项])` 会用同一份旧快照互相覆盖，
  // 结果是「一次拖 3 张图只剩最后 1 张」。（改造前用的是函数式 setState，天然没这个问题。）
  async function uploadImages(files: File[]): Promise<void> {
    const added: AttachmentMeta[] = []
    for (const f of files) {
      try {
        const buf = await f.arrayBuffer()
        const url = await window.api.saveAttachmentImage(attachFolder, f.name, buf)
        if (!url) throw new Error('附件保存未返回 URL')
        added.push({ id: crypto.randomUUID(), name: f.name, url, type: 'image' })
        insertHtml(`<img src="${url}" alt="${f.name}" />`)
      } catch (err) {
        console.error('upload image failed:', err)
        onStatus?.('图片上传失败：' + f.name, 'error')
      }
    }
    if (added.length > 0) onAttachmentsChange([...attachments, ...added])
  }

  // 事件监听只挂一次，通过 ref 取最新实现，避免闭包捕获过期的 attachments
  const uploadImagesRef = useRef(uploadImages)
  uploadImagesRef.current = uploadImages

  async function pickAttachments(): Promise<void> {
    const r = await window.api.pickAttachmentFiles(attachFolder)
    if (!r.ok || !r.files || r.files.length === 0) {
      if (!r.canceled && r.error) onStatus?.('附件添加失败：' + r.error, 'error')
      return
    }
    const links = r.files.map((f) => `<a href="${f.url}">📎 ${f.name}</a>`).join(' ')
    onAttachmentsChange([
      ...attachments,
      ...r.files.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        url: f.url,
        type: 'file' as const
      }))
    ])
    insertHtml(links + ' ')
    onStatus?.(`已添加 ${r.files.length} 个附件`)
  }

  function removeAttachment(att: AttachmentMeta): void {
    onAttachmentsChange(attachments.filter((a) => a.id !== att.id))
    void window.api.deleteAttachment(att.url)
    // 同时从正文移除对应引用（<img> 或 <a>）
    const editor = current()
    if (!editor) return
    const escaped = att.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const html = editor
      .getHTML()
      .replace(new RegExp(`<img[^>]*src=["']${escaped}["'][^>]*>`, 'g'), '')
      .replace(new RegExp(`<a[^>]*href=["']${escaped}["'][^>]*>.*?<\\/a>`, 'g'), '')
    editor.chain().focus().setContent(html, { emitUpdate: false }).run()
    onChange?.(html)
  }

  // ---- 粘贴 / 拖拽图片（捕获阶段拦截，避免 ProseMirror 重复处理） ----
  useEffect(() => {
    const el = containerRef.current
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

  // ---- 工具栏动作 ----
  const chain = (): ReturnType<Editor['chain']> | null => current()?.chain().focus() ?? null

  return (
    <>
      <div className="editor-wrapper">
        <div className="editor-toolbar">
          <button className="toolbar-btn" onClick={() => chain()?.toggleBold().run()} title="加粗" aria-label="加粗"><b>B</b></button>
          <button className="toolbar-btn" onClick={() => chain()?.toggleItalic().run()} title="斜体" aria-label="斜体"><i>I</i></button>
          <button className="toolbar-btn" onClick={() => chain()?.toggleUnderline().run()} title="下划线" aria-label="下划线"><u>U</u></button>
          <button className="toolbar-btn" onClick={() => chain()?.toggleStrike().run()} title="删除线" aria-label="删除线"><s>S</s></button>
          <button className="toolbar-btn" onClick={() => chain()?.toggleHighlight().run()} title="高亮" aria-label="高亮"><Highlighter size={15} /></button>
          <span className="toolbar-divider" />
          <button className="toolbar-btn" onClick={() => chain()?.toggleHeading({ level: 1 }).run()} title="标题 1" aria-label="标题 1">H1</button>
          <button className="toolbar-btn" onClick={() => chain()?.toggleHeading({ level: 2 }).run()} title="标题 2" aria-label="标题 2">H2</button>
          <button className="toolbar-btn" onClick={() => chain()?.toggleHeading({ level: 3 }).run()} title="标题 3" aria-label="标题 3">H3</button>
          <span className="toolbar-divider" />
          <button className="toolbar-btn" onClick={() => chain()?.toggleBulletList().run()} title="无序列表" aria-label="无序列表">•</button>
          <button className="toolbar-btn" onClick={() => chain()?.toggleOrderedList().run()} title="有序列表" aria-label="有序列表">1.</button>
          <button className="toolbar-btn" onClick={() => chain()?.toggleBlockquote().run()} title="引用" aria-label="引用"><TextQuote size={15} /></button>
          <button className="toolbar-btn" onClick={() => chain()?.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="插入表格" aria-label="插入表格">⊞</button>
          <button className="toolbar-btn" onClick={() => chain()?.setCodeBlock({ language: 'js' }).run()} title="代码块" aria-label="代码块">&lt;/&gt;</button>
          <button className="toolbar-btn" onClick={() => imageInputRef.current?.click()} title="插入图片" aria-label="插入图片"><ImageIcon size={15} /></button>
        </div>
        <div ref={containerRef} className="rich-editor-content" />
      </div>

      {showAttachments && (
        <>
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
                    aria-label="打开附件"
                    onClick={() => void window.api.openAttachment(a.url)}
                  >
                    <FolderOpen size={15} />
                  </button>
                  <button
                    className="icon-btn danger"
                    title="删除附件"
                    aria-label="删除附件"
                    onClick={() => removeAttachment(a)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* 隐藏的图片文件选择 */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          void uploadImages(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </>
  )
}
