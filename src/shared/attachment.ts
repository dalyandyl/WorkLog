/**
 * 附件通用工具：主进程与渲染层共用。
 * 只做纯字符串处理，不依赖 Node / Electron / DOM。
 *
 * 入库磁盘文件名 = 13 位时间戳前缀 + 用户原始文件名
 * （见 src/main/attachments.ts 的 uniqueName / sanitizeName）。
 */

/** 入库时加上的 13 位时间戳前缀 */
const TIMESTAMP_PREFIX = /^\d{13}_/

/** 去掉时间戳前缀，还原用户原始文件名 */
export function originalAttachmentName(fileName: string): string {
  const name = (fileName ?? '').trim()
  if (!name) return ''
  return name.replace(TIMESTAMP_PREFIX, '') || name
}

/** 从 wlattach:// URL 中取出磁盘文件名（含时间戳前缀） */
export function attachmentFileNameFromUrl(url: string): string {
  const raw = (url ?? '').split(/[?#]/)[0]
  const seg = raw.split('/').filter(Boolean).pop() ?? ''
  try {
    return decodeURIComponent(seg)
  } catch {
    return seg
  }
}

/** 附件展示名：优先用已知名字，否则从 URL 还原（两者都会去掉时间戳前缀） */
export function attachmentDisplayName(url: string, preferred?: string | null): string {
  const given = (preferred ?? '').trim()
  if (given) return originalAttachmentName(given)
  const fromUrl = attachmentFileNameFromUrl(url)
  return fromUrl ? originalAttachmentName(fromUrl) : '附件'
}

/** 扩展名（小写，不含点） */
export function attachmentExt(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec((name ?? '').trim())
  return m ? m[1].toLowerCase() : ''
}

/** 常见扩展名 -> 类型名（预览时用于告诉用户会由哪类程序打开） */
const TYPE_LABELS: Record<string, string> = {
  png: '图片', jpg: '图片', jpeg: '图片', gif: '图片', bmp: '图片', webp: '图片', svg: '图片', ico: '图片',
  pdf: 'PDF 文档',
  doc: 'Word 文档', docx: 'Word 文档', rtf: 'Word 文档',
  xls: 'Excel 表格', xlsx: 'Excel 表格', csv: '表格', xlsm: 'Excel 表格',
  ppt: 'PPT 演示文稿', pptx: 'PPT 演示文稿',
  txt: '文本文件', log: '日志文件', md: 'Markdown 文本', json: 'JSON 文本', xml: 'XML 文本',
  zip: '压缩包', rar: '压缩包', '7z': '压缩包', gz: '压缩包', tar: '压缩包',
  mp3: '音频', wav: '音频', flac: '音频', mp4: '视频', avi: '视频', mkv: '视频', mov: '视频'
}

/** 按扩展名给出人类可读的类型名 */
export function attachmentTypeLabel(name: string): string {
  const ext = attachmentExt(name)
  if (!ext) return '文件'
  return TYPE_LABELS[ext] ?? `${ext.toUpperCase()} 文件`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 附件卡片 HTML：只读视图（markdown-it 渲染）与编辑器 NodeView 共用同一份标记。
 * data-attach-url / data-attach-name 是卡片的唯一事实来源；
 * 卡片内的 [data-act] 元素由渲染层统一的事件委托处理（见 utils/attachmentActions.ts）。
 */
export function buildAttachmentCardHtml(url: string, name?: string | null): string {
  const shown = attachmentDisplayName(url, name)
  const ext = attachmentExt(shown)
  const badge = ext ? ext.toUpperCase().slice(0, 4) : 'FILE'
  const safeUrl = escapeHtml(url ?? '')
  const safeName = escapeHtml(shown)
  return (
    `<span class="attach-card" data-attachment="1" data-attach-url="${safeUrl}" data-attach-name="${safeName}">` +
    `<span class="attach-ext">${escapeHtml(badge)}</span>` +
    `<span class="attach-card-name" title="${safeName}">${safeName}</span>` +
    `<span class="attach-card-acts">` +
    `<span class="attach-act" role="button" tabindex="0" data-act="preview" data-url="${safeUrl}" title="预览：用系统默认程序打开（按文件类型自动选择）">预览</span>` +
    `<span class="attach-act" role="button" tabindex="0" data-act="download" data-url="${safeUrl}" title="下载到本地（另存为）">下载</span>` +
    `<span class="attach-act" role="button" tabindex="0" data-act="reveal" data-url="${safeUrl}" title="在文件夹中定位该附件">定位</span>` +
    `</span>` +
    `</span>`
  )
}
