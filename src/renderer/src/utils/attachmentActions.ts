import { attachmentTypeLabel } from '../../../shared/attachment'

export type AttachmentAction = 'preview' | 'download' | 'reveal'

type StatusReporter = ((msg: string) => void) | undefined

/** 附件名（用于提示文案）：优先用卡片上的 data-attach-name */
function nameOf(el: Element): string {
  const card = el.closest?.('[data-attach-name]')
  const given = card?.getAttribute('data-attach-name') ?? ''
  if (given) return given
  return '附件'
}

/**
 * 执行一次附件动作（预览 / 下载 / 定位）。
 * 预览走系统默认程序：主进程 shell.openPath 会按扩展名交给关联的软件打开。
 */
export async function runAttachmentAction(
  action: string,
  url: string,
  onStatus?: StatusReporter,
  name?: string
): Promise<void> {
  if (!url) return
  const shown = name || '附件'
  if (action === 'download') {
    const r = await window.api.downloadAttachment(url)
    if (!r.ok && !r.canceled) onStatus?.(`下载失败：${r.error ?? '未知错误'}`)
    else if (r.ok) onStatus?.(`已下载到 ${r.path ?? ''}`)
    return
  }
  if (action === 'reveal') {
    const r = await window.api.revealAttachment(url)
    if (!r.ok) onStatus?.(`定位失败：${r.error ?? '未知错误'}`)
    return
  }
  const r = await window.api.openAttachment(url)
  if (!r.ok) onStatus?.(`打开失败：${r.error ?? '未知错误'}`)
  else onStatus?.(`已用系统默认程序打开${attachmentTypeLabel(shown)}（${shown}）`)
}

/**
 * 统一的附件点击处理：可挂到任意容器的事件捕获阶段上。
 * 命中附件卡片（或遗留的 wlattach 链接）时返回 true，调用方应 preventDefault/stopPropagation。
 */
export function handleAttachmentClick(e: React.MouseEvent, onStatus?: StatusReporter): boolean {
  const target = e.target as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return false

  const act = target.closest('[data-act]') as HTMLElement | null
  if (act) {
    // 「删除」放行：由编辑器节点的 NodeView 自己处理（只有它知道节点位置）
    if (act.getAttribute('data-act') === 'remove') return false
    const url = act.getAttribute('data-url') ?? act.closest('[data-attach-url]')?.getAttribute('data-attach-url') ?? ''
    const shown = nameOf(act)
    void runAttachmentAction(act.getAttribute('data-act') ?? 'preview', url, onStatus, shown)
    return true
  }

  const a = target.closest('a') as HTMLAnchorElement | null
  const href = a?.getAttribute('href') ?? ''
  if (a && (a.hasAttribute('data-attachment') || href.startsWith('wlattach://'))) {
    void runAttachmentAction('preview', href, onStatus, a.getAttribute('data-attach-name') ?? a.textContent ?? '')
    return true
  }
  return false
}

/** data-act 元素的可访问性：Enter / 空格触发 */
export function handleAttachmentKey(e: React.KeyboardEvent, onStatus?: StatusReporter): boolean {
  if (e.key !== 'Enter' && e.key !== ' ') return false
  const target = e.target as HTMLElement | null
  const act = target?.closest?.('[data-act]') as HTMLElement | null
  if (!act) return false
  // 「删除」放行给 NodeView
  if (act.getAttribute('data-act') === 'remove') return false
  e.preventDefault()
  void runAttachmentAction(
    act.getAttribute('data-act') ?? 'preview',
    act.getAttribute('data-url') ?? '',
    onStatus,
    nameOf(act)
  )
  return true
}
