import MarkdownIt from 'markdown-it'

/** 全局 markdown -> HTML 渲染器（允许内嵌 HTML，保留附件/公式标签） */
export const mdRenderer = new MarkdownIt({ html: true, linkify: true, breaks: true })

export function renderMarkdown(md: string): string {
  return md ? mdRenderer.render(md) : ''
}
