import MarkdownIt from 'markdown-it'
import { sanitizeHtml } from './sanitize'

/**
 * 全局 markdown -> HTML 渲染器。
 * 允许内嵌 HTML（保留附件图片与公式占位标签），但输出**必须**经过 `sanitizeHtml` 净化 ——
 * 渲染出口是 `dangerouslySetInnerHTML`，不净化就等于允许正文注入脚本。
 */
export const mdRenderer = new MarkdownIt({ html: true, linkify: true, breaks: true })

export function renderMarkdown(md: string): string {
  return md ? sanitizeHtml(mdRenderer.render(md)) : ''
}
