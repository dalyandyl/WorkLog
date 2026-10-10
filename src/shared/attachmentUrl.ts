/**
 * 附件 URL 的归一化 —— 渲染层与 preload 共用的纯函数。
 *
 * 为什么需要它（真实事故）：
 *   `ipcRenderer.invoke` 的返回类型是 `any`，因此 preload 上声明的返回类型
 *   **不会在运行时被校验**，TypeScript 也拦不住形状不符。
 *   历史上 `attach:saveImage` 返回的是 `{ url, file }` 对象，而渲染层按字符串使用：
 *     `insertAtCursor(`![](${url})`)`        → `![]( [object Object] )`
 *     `insertHtml(`<img src="${url}" …>`)`   → `<img src="[object Object]" alt="文件名">`
 *   结果：**任务正文与会议纪要里的图片永远显示为「破图图标 + 文件名」**，
 *   而且不报错、不崩溃，所以长期没人发现。
 *
 * 现在主进程只返回 url 字符串；这个函数作为第二道防线，
 * 万一将来又退回对象形态，也能拿到正确 URL 而不是静默产生 `[object Object]`。
 */
export function normalizeAttachmentUrl(result: unknown, channel = 'attach:saveImage'): string {
  if (typeof result === 'string') return result

  const url = (result as { url?: unknown } | null | undefined)?.url
  if (typeof url === 'string') {
    console.warn(
      `[attachment] ${channel} 返回了对象而非 url 字符串，已自动取 .url（主进程契约应为 string）`
    )
    return url
  }

  console.error(`[attachment] ${channel} 未返回可用的附件 url：`, result)
  return ''
}
