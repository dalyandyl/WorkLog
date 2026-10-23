import MarkdownIt from 'markdown-it'
import { attachmentDisplayName, buildAttachmentCardHtml } from '../../../shared/attachment'

/** 全局 markdown -> HTML 渲染器（允许内嵌 HTML，保留附件/公式标签） */
export const mdRenderer = new MarkdownIt({ html: true, linkify: true, breaks: true })

type MdRenderer = typeof mdRenderer

/**
 * 附件卡片渲染：把 `[📎 文件名](wlattach://...)` 直接渲染成卡片 DOM，
 * 与编辑器里的 NodeView 保持同一套标记（见 src/shared/attachment.ts）。
 * 图片依旧走 markdown-it 自带的 image 规则（`![](wlattach://...)`）。
 */
function attachmentCards(md: MdRenderer): void {
  md.core.ruler.push('wl_attachment_cards', (state) => {
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue
      const children = block.children
      for (let i = 0; i < children.length; i++) {
        const open = children[i]
        if (open.type !== 'link_open') continue
        const href = String(open.attrGet('href') ?? '')
        if (!href.startsWith('wlattach://')) continue

        // 找到配对的 link_close
        let depth = 0
        let end = -1
        for (let k = i; k < children.length; k++) {
          if (children[k].type === 'link_open') depth += 1
          else if (children[k].type === 'link_close') {
            depth -= 1
            if (depth === 0) {
              end = k
              break
            }
          }
        }
        if (end < 0) continue

        const text = children
          .slice(i + 1, end)
          .map((t) => (t.type === 'text' ? t.content : ''))
          .join('')
        // 复用 link_open 令牌承载整段卡片 HTML（渲染器允许内嵌 HTML，直接原样输出）
        open.type = 'html_inline'
        open.tag = ''
        open.nesting = 0
        open.attrs = null
        open.content = buildAttachmentCardHtml(href, attachmentDisplayName(href, text.replace(/^📎\s*/, '')))
        open.markup = ''
        open.children = null
        open.info = ''
        open.meta = null
        open.block = false
        open.hidden = false
        children.splice(i + 1, end - i)
        i += 1
      }
    }
    return true
  })
}

attachmentCards(mdRenderer)

export function renderMarkdown(md: string): string {
  return md ? mdRenderer.render(md) : ''
}
