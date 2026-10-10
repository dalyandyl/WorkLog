import { useEffect, useRef } from 'react'
import { renderMarkdown } from '../utils/markdown'
import { sanitizeHtml } from '../utils/sanitize'

interface RichViewProps {
  content: string
  /**
   * 内容形态：
   * - `markdown`（默认）：任务 / 周总结等 Markdown 正文
   * - `html`：会议纪要这类由 TipTap 直接产出的 HTML —— 不能再走 markdown-it，
   *   否则缩进的 HTML 会被当成代码块破坏排版；直接净化后渲染。
   */
  kind?: 'markdown' | 'html'
}

/** 只读渲染：内容 -> 净化后的 HTML（补渲染公式、拦截附件点击） */
export default function RichView({ content, kind = 'markdown' }: RichViewProps) {
  const ref = useRef<HTMLDivElement>(null)

  const renderedHtml = kind === 'html' ? sanitizeHtml(content) : renderMarkdown(content)

  // KaTeX 按需加载：仅在正文包含公式时才动态引入（减少启动内存/解析开销）
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const nodes = el.querySelectorAll('span[data-math]')
    if (nodes.length === 0) return
    let cancelled = false
    void import('katex').then(({ default: katex }) => {
      if (cancelled || !ref.current) return
      ref.current.querySelectorAll('span[data-math]').forEach((n) => {
        const target = n as HTMLElement
        if (target.dataset.rendered === '1') return
        const latex = target.getAttribute('data-math') ?? ''
        try {
          target.innerHTML = katex.renderToString(latex || '?', { throwOnError: false })
        } catch {
          target.textContent = latex
        }
        target.dataset.rendered = '1'
      })
    })
    return () => {
      cancelled = true
    }
  }, [renderedHtml])

  function onClickCapture(e: React.MouseEvent): void {
    const target = e.target as HTMLElement
    const a = target.closest?.('a') as HTMLAnchorElement | null
    if (a && (a.hasAttribute('data-attachment') || (a.getAttribute('href') ?? '').startsWith('wlattach://'))) {
      e.preventDefault()
      e.stopPropagation()
      void window.api.openAttachment(a.getAttribute('href') ?? '')
    }
  }

  return (
    <div
      ref={ref}
      className="rich-content rich-view"
      onClickCapture={onClickCapture}
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  )
}
