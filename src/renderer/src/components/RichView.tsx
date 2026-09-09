import { useEffect, useRef } from 'react'
import { renderMarkdown } from '../utils/markdown'

/** 只读渲染：Markdown -> HTML（补渲染公式、拦截附件点击） */
export default function RichView({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null)

  const renderedHtml = renderMarkdown(content)

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
