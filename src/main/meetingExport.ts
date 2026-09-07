import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import type { Meeting } from '../shared/types'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*'
})

// GFM：表格 / 删除线等
turndown.use(gfm)

// 高亮 / 下划线没有通用 Markdown 语法，导出时保留纯文本
turndown.addRule('mark', { filter: 'mark', replacement: (content) => content })
turndown.addRule('u', { filter: 'u', replacement: (content) => content })
// 删除线统一输出为标准 ~~text~~
turndown.addRule('strikethrough', {
  filter: ['del', 's', 'strike'],
  replacement: (content) => '~~' + content + '~~'
})

/** 把 wlattach:// 绝对链接改写成相对路径，便于导出文件在外部查看 */
function relativizeWlattach(html: string): string {
  return html.replace(/wlattach:\/\/attachments\//g, 'attachments/')
}

/** 会议纪要 → Markdown（含元信息头与附件清单） */
export function meetingToMarkdown(meeting: Meeting, tagNames: string[]): string {
  const sections: string[] = [
    `# ${meeting.title || '未命名会议'}`,
    '',
    `- 日期：${meeting.date}`
  ]
  if (tagNames.length > 0) sections.push(`- 标签：${tagNames.join('、')}`)
  if (meeting.attachments.length > 0) {
    sections.push('- 附件：')
    for (const a of meeting.attachments) sections.push(`  - ${a.name}`)
  }
  sections.push('', '---', '')
  const body = turndown.turndown(relativizeWlattach(meeting.body || '')).trim()
  sections.push(body)
  return sections.join('\n').replace(/\n{3,}/g, '\n\n') + '\n'
}

/** 导出文件名（清理非法字符） */
export function meetingExportFileName(m: Meeting): string {
  const safe = (m.title || '未命名会议').replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名会议'
  return `${m.date}_${safe}.md`
}
