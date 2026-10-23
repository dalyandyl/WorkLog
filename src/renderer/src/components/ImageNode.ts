import { Image } from '@tiptap/extension-image'
import type { NodeView } from '@tiptap/pm/view'

/**
 * 图片节点：与 @tiptap/extension-image 完全相同，只是在 NodeView 的右上角加一个删除按钮。
 *
 * ⚠️ 删除按钮**只存在于实时 DOM（NodeView）**，不在 renderHTML 里 ——
 * 所以 editor.getHTML()（会议纪要存 HTML）与 turndown（日报正文存 Markdown）
 * 序列化出来的磁盘内容里都不会带上它。
 */
const ImageWithRemove = Image.extend({
  addNodeView() {
    return ({ node, getPos, editor }): NodeView => {
      let current = node

      const dom = document.createElement('div')
      dom.className = 'img-node'
      dom.contentEditable = 'false'

      const img = document.createElement('img')
      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'img-node-del'
      del.setAttribute('title', '删除图片')
      del.setAttribute('aria-label', '删除图片')
      del.textContent = '✕'
      dom.append(img, del)

      const paint = (n: typeof node): void => {
        const src = (n.attrs.src as string) ?? ''
        if (src) img.setAttribute('src', src)
        else img.removeAttribute('src')
        img.setAttribute('alt', (n.attrs.alt as string) ?? '')
        const title = n.attrs.title as string | null
        if (title) img.setAttribute('title', title)
        else img.removeAttribute('title')
      }
      paint(current)

      del.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (typeof pos !== 'number') return
        editor.chain().focus().deleteRange({ from: pos, to: pos + current.nodeSize }).run()
      })

      return {
        dom,
        // 整个 NodeView 由我们自己维护，不让 ProseMirror 接管内部 DOM 变更
        ignoreMutation: () => true,
        stopEvent: () => false,
        update: (updated) => {
          if (updated.type.name !== 'image') return false
          current = updated
          paint(updated)
          return true
        }
      }
    }
  }
})

export default ImageWithRemove
