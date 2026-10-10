/**
 * HTML 净化（sanitize）。
 *
 * 背景：`renderMarkdown` 使用 `MarkdownIt({ html: true })` 且不做净化，
 * 渲染出口 `RichView` 用 `dangerouslySetInnerHTML` 注入 —— 任务正文 / 会议正文里
 * 只要出现 `<img src=x onerror=...>` 之类内容就会在渲染进程执行。
 * 渲染层虽然 `contextIsolation: true` 且没有 `nodeIntegration`，脚本无法直接操作文件系统，
 * 但可以调用**全部** `window.api`（含附件写入 / 备份 / 同步），因此必须净化。
 * 见 memory-bank/07-optimization-backlog.md P3-1。
 *
 * 为什么不用 DOMPurify：安装包只剩约 2.8MB 余量（Gitee 附件上限 100MB），
 * 这里采用**默认拒绝的允许列表**实现，覆盖本项目实际会产生的标签与属性集合；
 * 若将来需要承载更自由的富文本，应换成 DOMPurify 并重新评估体积。
 */

/** 允许保留的标签 */
const ALLOWED_TAGS = new Set([
  // 文本与段落
  'p', 'br', 'hr', 'span', 'div',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup', 'small',
  'code', 'pre', 'blockquote',
  // 标题
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // 列表
  'ul', 'ol', 'li',
  // 表格（TipTap 表格 + markdown-it 表格）
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  // 链接与图片
  'a', 'img'
])

/**
 * 必须**整棵子树一并删除**的标签（保留文本没有意义且可能残留可执行内容）。
 * 其余不在允许列表里的标签采用"拆壳保子"（unwrap），避免误删用户正文。
 */
const DROP_WITH_SUBTREE = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'link', 'meta', 'base', 'form', 'input', 'button', 'select', 'option', 'textarea',
  'svg', 'math', 'noscript', 'template', 'audio', 'video', 'source', 'track', 'canvas'
])

/**
 * 所有标签都允许的属性。
 * `style` 也在此列，但会额外经过 `isSafeStyle` 检查（TipTap 的文字颜色 / 高亮、
 * 表格列宽、图片尺寸都靠它承载）。
 */
const GLOBAL_ATTRS = new Set(['class', 'style', 'title', 'dir', 'lang', 'id'])

/** 各标签额外允许的属性 */
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel', 'data-attachment']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['colspan', 'rowspan', 'colwidth', 'align', 'valign']),
  th: new Set(['colspan', 'rowspan', 'colwidth', 'align', 'valign']),
  col: new Set(['span', 'width']),
  colgroup: new Set(['span']),
  table: new Set(['border', 'cellpadding', 'cellspacing']),
  // KaTeX / 公式占位：RichView 会查找 span[data-math] 再渲染
  span: new Set(['data-math', 'aria-hidden', 'data-rendered'])
}

/** 需要校验协议/内容的属性 */
const URL_ATTRS = new Set(['href', 'src'])

/** 允许的 URL 协议（含应用自定义的 wlattach:// 附件协议与内联图片） */
const SAFE_URL = /^(https?:|mailto:|wlattach:|#|\/|\.\/|\.\.\/|data:image\/(png|jpe?g|gif|webp|bmp);base64,)/i

/** style 中不允许出现的内容（CSS 注入面：外链加载、表达式、定位覆盖层） */
const UNSAFE_STYLE = /url\s*\(|expression\s*\(|javascript:|vbscript:|@import|behavior\s*:|position\s*:\s*fixed|position\s*:\s*absolute/i

function isSafeUrl(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  // 去掉控制字符后判断（`java\nscript:` 这类绕过）
  // eslint-disable-next-line no-control-regex
  const normalized = v.replace(/[\u0000-\u0020]/g, '')
  return SAFE_URL.test(normalized)
}

function isSafeStyle(value: string): boolean {
  return !UNSAFE_STYLE.test(value)
}

/** 把一个标签拆壳：保留其子节点，删除标签本身 */
function unwrap(el: Element): void {
  const parent = el.parentNode
  if (!parent) return
  while (el.firstChild) parent.insertBefore(el.firstChild, el)
  parent.removeChild(el)
}

/**
 * 净化 HTML 字符串，返回只含允许标签/属性的结果。
 * 在无 DOM 环境（如纯 Node 单测未注入 DOM）下直接返回空串，避免抛错。
 *
 * 实现刻意只用 `createElement` / `innerHTML` / `querySelectorAll('*')` 这几个
 * 最通用的 DOM API（不用 `<template>.content`、不用 `TreeWalker`），
 * 这样在只实现基础 DOM 的环境里也能跑，便于用 domino 之类的轻量实现做单测。
 */
export function sanitizeHtml(html: string): string {
  if (!html) return ''
  if (typeof document === 'undefined') return ''

  const root = document.createElement('div')
  root.innerHTML = html

  // querySelectorAll 按文档顺序返回（父在子前）。即使父节点被删/拆壳，
  // 后续对已脱离文档的子节点操作也是安全的空操作。
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase()

    if (DROP_WITH_SUBTREE.has(tag)) {
      el.remove()
      continue
    }
    if (!ALLOWED_TAGS.has(tag)) {
      unwrap(el)
      continue
    }

    const extra = TAG_ATTRS[tag]
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      // 事件处理器一律去掉
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name)
        continue
      }
      const allowed = GLOBAL_ATTRS.has(name) || (extra ? extra.has(name) : false)
      if (!allowed) {
        el.removeAttribute(attr.name)
        continue
      }
      if (URL_ATTRS.has(name) && !isSafeUrl(attr.value)) {
        el.removeAttribute(attr.name)
        continue
      }
      if (name === 'style' && !isSafeStyle(attr.value)) {
        el.removeAttribute(attr.name)
      }
    }
  }

  return root.innerHTML
}
