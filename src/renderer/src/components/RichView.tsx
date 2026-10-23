import { useEffect, useRef } from 'react'
import { renderMarkdown } from '../utils/markdown'
import { handleAttachmentClick } from '../utils/attachmentActions'

/** 只读渲染：Markdown -> HTML（补渲染公式、拦截附件/图片按钮点击） */
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
    if (handleAttachmentClick(e)) {
      e.preventDefault()
      e.stopPropagation()
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
