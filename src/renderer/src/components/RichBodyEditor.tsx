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
import {
  Bold,
  Code,
  FileCode,
  Heading1,
  Heading2,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  Paperclip,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Undo2
} from 'lucide-react'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { attachmentDisplayName } from '../../../shared/attachment'
import { renderMarkdown } from '../utils/markdown'
import { handleAttachmentClick, handleAttachmentKey } from '../utils/attachmentActions'
import AttachmentCard from './AttachmentNode'
import ImageWithRemove from './ImageNode'

const lowlight = createLowlight(common)

/**
 * 富文本 -> Markdown 转换器。
 * 规则与主进程 src/main/meetingExport.ts 保持一致，保证"编辑器里看到什么，导出的 Markdown 就是什么"。
 * 存储仍然是 Markdown（导出的 Word/MD 直接原样引用 task.body，见 src/main/exporter.ts）。
 */
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*'
})
turndown.use(gfm)

// 附件卡片 -> Markdown 链接（附件信息存在 data-* 上，不依赖卡片里的按钮文字）
turndown.addRule('wlAttachment', {
  filter: (node) => node.nodeName === 'SPAN' && (node as HTMLElement).hasAttribute('data-attach-url'),
  replacement: (_content, node) => {
    const el = node as HTMLElement
    const url = el.getAttribute('data-attach-url') ?? ''
    if (!url) return ''
    const name = attachmentDisplayName(url, el.getAttribute('data-attach-name'))
    return `[📎 ${name}](${url})`
  }
})

// 图片：统一成 ![](url)（alt 沿用节点上的值，通常为空）
turndown.addRule('wlImage', {
  filter: 'img',
  replacement: (_content, node) => {
    const el = node as HTMLImageElement
    const src = el.getAttribute('src') ?? ''
    if (!src) return ''
    return `![${el.getAttribute('alt') ?? ''}](${src})`
  }
})

interface RichBodyEditorProps {
  value: string
  onChange: (markdown: string) => void
  /** 附件存放目录（与主进程 attachments 目录约定一致） */
  attachFolder: string
  onStatus?: (msg: string) => void
}

/**
 * 正文富文本编辑器（日报任务正文 / 任务发布正文共用）。
 * 对外仍然是 Markdown 字符串：Markdown 进（markdown-it 转 HTML），Markdown 出（turndown 转回）。
 */
export default function RichBodyEditor({ value, onChange, attachFolder, onStatus }: RichBodyEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  /** 最近一次由本编辑器产出的 Markdown：用来区分"外部改值"和"自己的回写" */
  const lastOutRef = useRef(value)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const onStatusRef = useRef(onStatus)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)

  valueRef.current = value
  onChangeRef.current = onChange
  onStatusRef.current = onStatus

  // ---- 初始化（仅一次） ----
  useEffect(() => {
    const host = hostRef.current
    if (!host || editorRef.current) return
    let editor: Editor | null = null
    try {
      editor = new Editor({
        element: host,
        extensions: [
          StarterKit.configure({ codeBlock: false, link: { openOnClick: false } }),
          Table.configure({ resizable: true }),
          TableCell.extend({ content: 'block+' }),
          TableHeader.extend({ content: 'block+' }),
          TableRow,
          CodeBlockLowlight.configure({ lowlight }),
          Highlight,
          TextStyle,
          Color,
          ImageWithRemove.configure({ allowBase64: false }),
          AttachmentCard
        ],
        content: renderMarkdown(valueRef.current),
        onUpdate: ({ editor: ed }) => {
          const md = turndown.turndown(ed.getHTML()).replace(/^\n+/, '').replace(/\n+$/, '')
          lastOutRef.current = md
          onChangeRef.current(md)
        }
      })
      editorRef.current = editor
      editor.on('transaction', () => setTick((n) => n + 1))
    } catch (err) {
      console.error('RichBodyEditor 初始化失败:', err)
      setFailed(true)
    }
    return () => {
      editor?.destroy()
      editorRef.current = null
    }
  }, [])

  // ---- 外部改值（例如切换任务）时同步内容 ----
  useEffect(() => {
    const ed = editorRef.current
    if (!ed || failed) return
    if (value === lastOutRef.current) return
    lastOutRef.current = value
    ed.commands.setContent(renderMarkdown(value), { emitUpdate: false })
  }, [value, failed])

  async function insertImages(files: File[]): Promise<void> {
    const ed = editorRef.current
    if (!ed) return
    let count = 0
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue
      try {
        const buf = await f.arrayBuffer()
        const url = await window.api.saveAttachmentImage(attachFolder, f.name, buf)
        if (typeof url !== 'string' || !url) continue
        ed.chain().focus().setImage({ src: url }).run()
        count += 1
      } catch (err) {
        console.error('插入图片失败:', err)
      }
    }
    onStatusRef.current?.(count > 0 ? `已插入 ${count} 张图片` : '图片插入失败')
  }

  async function pickAttachments(): Promise<void> {
    const ed = editorRef.current
    if (!ed) return
    const r = await window.api.pickAttachmentFiles(attachFolder)
    if (!r.ok || !r.files || r.files.length === 0) return
    const content: { type: string; attrs?: Record<string, unknown>; text?: string }[] = []
    r.files.forEach((f, i) => {
      if (i > 0) content.push({ type: 'text', text: ' ' })
      content.push({ type: 'attachment', attrs: { url: f.url, name: f.name } })
    })
    ed.chain().focus().insertContent(content).run()
    onStatusRef.current?.(`已插入 ${r.files.length} 个附件`)
  }

  async function onPasteCapture(e: React.ClipboardEvent): Promise<void> {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) return
    e.preventDefault()
    await insertImages(files)
  }

  async function onDropCapture(e: React.DragEvent): Promise<void> {
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) return
    e.preventDefault()
    await insertImages(files)
  }

  if (failed) {
    // 富文本初始化失败时退回纯文本，至少不丢内容
    return (
      <div className="rich-body-editor">
        <textarea
          className="md-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="（富文本初始化失败，已退回纯文本 Markdown）"
        />
      </div>
    )
  }

  const ed = editorRef.current
  const active = (name: string, attrs?: Record<string, unknown>): boolean =>
    ed ? (attrs ? ed.isActive(name, attrs) : ed.isActive(name)) : false

  return (
    <div
      className="editor-wrapper rich-body-editor"
      onPasteCapture={(e) => void onPasteCapture(e)}
      onDropCapture={(e) => void onDropCapture(e)}
      onClickCapture={(e) => {
        if (handleAttachmentClick(e, onStatusRef.current)) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      onKeyDownCapture={(e) => {
        if (handleAttachmentKey(e, onStatusRef.current)) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      data-tick={tick}
    >
      <div className="editor-toolbar">
        <button type="button" className="toolbar-btn" title="撤销" onClick={() => ed?.chain().focus().undo().run()}>
          <Undo2 size={15} />
        </button>
        <button type="button" className="toolbar-btn" title="重做" onClick={() => ed?.chain().focus().redo().run()}>
          <Redo2 size={15} />
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          className={active('bold') ? 'toolbar-btn active' : 'toolbar-btn'}
          title="加粗"
          onClick={() => ed?.chain().focus().toggleBold().run()}
        >
          <Bold size={15} />
        </button>
        <button
          type="button"
          className={active('italic') ? 'toolbar-btn active' : 'toolbar-btn'}
          title="斜体"
          onClick={() => ed?.chain().focus().toggleItalic().run()}
        >
          <Italic size={15} />
        </button>
        <button
          type="button"
          className={active('strike') ? 'toolbar-btn active' : 'toolbar-btn'}
          title="删除线"
          onClick={() => ed?.chain().focus().toggleStrike().run()}
        >
          <Strikethrough size={15} />
        </button>
        <button
          type="button"
          className={active('code') ? 'toolbar-btn active' : 'toolbar-btn'}
          title="行内代码"
          onClick={() => ed?.chain().focus().toggleCode().run()}
        >
          <Code size={15} />
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          className={active('heading', { level: 1 }) ? 'toolbar-btn active' : 'toolbar-btn'}
          title="标题1"
          onClick={() => ed?.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Heading1 size={15} />
        </button>
        <button
          type="button"
          className={active('heading', { level: 2 }) ? 'toolbar-btn active' : 'toolbar-btn'}
          title="标题2"
          onClick={() => ed?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 size={15} />
        </button>
        <button
          type="button"
          className={active('bulletList') ? 'toolbar-btn active' : 'toolbar-btn'}
          title="无序列表"
          onClick={() => ed?.chain().focus().toggleBulletList().run()}
        >
          <List size={15} />
        </button>
        <button
          type="button"
          className={active('orderedList') ? 'toolbar-btn active' : 'toolbar-btn'}
          title="有序列表"
          onClick={() => ed?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={15} />
        </button>
        <button
          type="button"
          className={active('blockquote') ? 'toolbar-btn active' : 'toolbar-btn'}
          title="引用"
          onClick={() => ed?.chain().focus().toggleBlockquote().run()}
        >
          <Quote size={15} />
        </button>
        <button
          type="button"
          className={active('codeBlock') ? 'toolbar-btn active' : 'toolbar-btn'}
          title="代码块"
          onClick={() => ed?.chain().focus().toggleCodeBlock().run()}
        >
          <FileCode size={15} />
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          className="toolbar-btn"
          title="插入表格"
          onClick={() => ed?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        >
          <TableIcon size={15} />
        </button>
        <button type="button" className="toolbar-btn" title="插入图片" onClick={() => imageInputRef.current?.click()}>
          <ImageIcon size={15} />
        </button>
        <button type="button" className="toolbar-btn" title="插入附件" onClick={() => void pickAttachments()}>
          <Paperclip size={15} />
        </button>
      </div>
      <div className="rich-editor-content" ref={hostRef} />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const list = Array.from(e.target.files ?? [])
          e.target.value = ''
          void insertImages(list)
        }}
      />
    </div>
  )
}
