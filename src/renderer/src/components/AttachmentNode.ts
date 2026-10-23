import { Node, mergeAttributes } from '@tiptap/core'
import { attachmentDisplayName, attachmentExt } from '../../../shared/attachment'

/**
 * 附件卡片节点（行内原子节点）。
 *
 * - 磁盘上的唯一事实来源是 data-attach-url / data-attach-name；
 * - 序列化出的 HTML 与 src/shared/attachment.ts 的 buildAttachmentCardHtml 保持一致，
 *   这样只读视图（markdown-it）与编辑器（NodeView）看到的是同一套样式；
 * - 卡片里的 [data-act] 按钮不在这里处理，由外层容器的事件委托统一处理
 *   （见 src/renderer/src/utils/attachmentActions.ts）。
 */
const AttachmentCard = Node.create({
  name: 'attachment',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      url: {
        default: '',
        parseHTML: (element) =>
          element.getAttribute('data-attach-url') ?? element.getAttribute('href') ?? '',
        renderHTML: (attributes) => ({ 'data-attach-url': attributes.url })
      },
      name: {
        default: '',
        parseHTML: (element) => {
          const given = element.getAttribute('data-attach-name')
          if (given) return given
          // 兼容旧的 Markdown 链接文本：[📎 文件名](wlattach://...)
          return (element.textContent ?? '').replace(/^📎\s*/, '').trim()
        },
        renderHTML: (attributes) => ({ 'data-attach-name': attributes.name })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-attach-url]' }, { tag: 'a[href^="wlattach://"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const url = (node.attrs.url as string) ?? ''
    const shown = attachmentDisplayName(url, node.attrs.name as string)
    const ext = attachmentExt(shown)
    const badge = ext ? ext.toUpperCase().slice(0, 4) : 'FILE'
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'attach-card', 'data-attachment': '1' }),
      ['span', { class: 'attach-ext' }, badge],
      ['span', { class: 'attach-card-name', title: shown }, shown],
      [
        'span',
        { class: 'attach-card-acts' },
        [
          'span',
          { class: 'attach-act', role: 'button', tabindex: '0', 'data-act': 'preview', 'data-url': url, title: '预览：用系统默认程序打开（按文件类型自动选择）' },
          '预览'
        ],
        [
          'span',
          { class: 'attach-act', role: 'button', tabindex: '0', 'data-act': 'download', 'data-url': url, title: '下载到本地（另存为）' },
          '下载'
        ],
        [
          'span',
          { class: 'attach-act', role: 'button', tabindex: '0', 'data-act': 'reveal', 'data-url': url, title: '在文件夹中定位该附件' },
          '定位'
        ]
      ]
    ]
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node

      const dom = document.createElement('span')
      dom.className = 'attach-card attach-card-edit'
      dom.setAttribute('data-attachment', '1')
      dom.contentEditable = 'false'

      const paint = (attrs: { url?: string; name?: string }): void => {
        const url = attrs.url ?? ''
        const shown = attachmentDisplayName(url, attrs.name)
        const ext = attachmentExt(shown)
        const badge = ext ? ext.toUpperCase().slice(0, 4) : 'FILE'
        dom.setAttribute('data-attach-url', url)
        dom.setAttribute('data-attach-name', shown)
        dom.setAttribute('title', shown)
        dom.innerHTML =
          `<span class="attach-ext">${badge}</span>` +
          `<span class="attach-card-name">${escapeText(shown)}</span>` +
          `<span class="attach-card-acts">` +
          `<span class="attach-act" role="button" tabindex="0" data-act="preview" data-url="${escapeAttr(url)}" title="预览：用系统默认程序打开（按文件类型自动选择）">预览</span>` +
          `<span class="attach-act" role="button" tabindex="0" data-act="download" data-url="${escapeAttr(url)}" title="下载到本地（另存为）">下载</span>` +
          `<span class="attach-act" role="button" tabindex="0" data-act="reveal" data-url="${escapeAttr(url)}" title="在文件夹中定位该附件">定位</span>` +
          // ⚠️ 只有编辑态的 NodeView 才画这个「删除」按钮（renderHTML 里没有它），
          // 因此它不会被写进磁盘上的 Markdown / HTML。
          `<span class="attach-act attach-act-remove" role="button" tabindex="0" data-act="remove" title="删除该附件">✕</span>` +
          `</span>`
      }

      paint(current.attrs as { url?: string; name?: string })

      // 「删除」由这里处理：只有 NodeView 才知道自己的节点位置
      const onRemove = (e: Event): void => {
        const target = e.target as HTMLElement | null
        if (!target || typeof target.closest !== 'function') return
        if (!target.closest('[data-act="remove"]')) return
        e.preventDefault()
        e.stopPropagation()
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (typeof pos !== 'number') return
        editor.chain().focus().deleteRange({ from: pos, to: pos + current.nodeSize }).run()
      }
      dom.addEventListener('click', onRemove)
      dom.addEventListener('keydown', (e) => {
        const key = (e as KeyboardEvent).key
        if (key === 'Enter' || key === ' ') onRemove(e)
      })

      return {
        dom,
        // 卡片内部按需重绘，不让 ProseMirror 接管这些 DOM 变更
        ignoreMutation: () => true,
        stopEvent: () => false,
        update: (updated) => {
          if (updated.type.name !== 'attachment') return false
          current = updated
          paint(updated.attrs as { url?: string; name?: string })
          return true
        }
      }
    }
  }
})

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;')
}

export default AttachmentCard
