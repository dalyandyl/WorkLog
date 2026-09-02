import { useEffect, useRef } from 'react'
import katex from 'katex'
import { renderMarkdown } from '../utils/markdown'

/** 只读渲染：Markdown -> HTML（补渲染公式、拦截附件点击） */
export default function RichView({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null)

  const renderedHtml = renderMarkdown(content)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.querySelectorAll('span[data-math]').forEach((n) => {
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
