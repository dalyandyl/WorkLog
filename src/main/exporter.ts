import { readTags, type Tag } from './tags'
import { readTasks, type Task } from './tasks'
import { readRestMap } from './meta'
import { getWeekInfoByKey, readWeeklySummary } from './weekly'
import { enumerateDates, weekdayName } from './storage'

function tagNameMap(tags: Tag[]): Map<string, string> {
  return new Map(tags.map((t) => [t.id, t.name]))
}

function tagLabel(task: Task, names: Map<string, string>): string {
  if (task.tags.length === 0) return ''
  const parts = task.tags
    .map((id) => names.get(id))
    .filter((n): n is string => Boolean(n))
    .map((n) => `\`#${n}\``)
  return parts.length > 0 ? ' ' + parts.join(' ') : ''
}

/** 任务概览行（含子任务缩进行） */
function taskOverviewLines(task: Task, names: Map<string, string>): string[] {
  const lines: string[] = [`- [${task.done ? 'x' : ' '}] ${task.title}${tagLabel(task, names)}`]
  for (const st of task.subtasks ?? []) {
    lines.push(`    - [${st.done ? 'x' : ' '}] ${st.title}`)
  }
  return lines
}

/** 单个任务的正文档段 */
function taskBodySection(task: Task, names: Map<string, string>): string[] {
  if (!task.body || task.body.trim() === '') return []
  const title = `${task.done ? '✅ ' : ''}${task.title}${tagLabel(task, names)}`
  return [`### ${title}`, '', task.body.trim(), '']
}

/** 单日任务清单（概览 + 各任务正文），可按项目过滤 */
async function daySection(
  root: string,
  date: string,
  names: Map<string, string>,
  restSet: Set<string>,
  projectId?: string
): Promise<string[]> {
  const rest = restSet.has(date)
  const heading = `## ${date} ${weekdayName(date)}${rest ? '（休息日）' : ''}`
  const all = await readTasks(root, date)
  const tasks = projectId ? all.filter((t) => t.projectId === projectId) : all
  if (tasks.length === 0) {
    return rest ? [heading, ''] : []
  }
  const lines: string[] = [heading, '']
  for (const t of tasks) {
    lines.push(...taskOverviewLines(t, names))
  }
  lines.push('')
  for (const t of tasks) {
    lines.push(...taskBodySection(t, names))
  }
  return lines
}

/** 单日导出 */
export async function buildDayMarkdown(
  root: string,
  date: string,
  projectId?: string
): Promise<string> {
  const [tags, restSet] = await Promise.all([readTags(root), readRestMap(root)])
  const names = tagNameMap(tags)
  const rest = restSet.has(date)
  const parts: string[] = [`# 日志工具 ${date} ${weekdayName(date)}${rest ? '（休息日）' : ''}`, '']
  const all = await readTasks(root, date)
  const tasks = projectId ? all.filter((t) => t.projectId === projectId) : all
  if (tasks.length === 0) {
    parts.push(rest ? '（休息日）' : '（当日无任务）', '')
    return parts.join('\n') + '\n'
  }
  for (const t of tasks) {
    parts.push(...taskOverviewLines(t, names))
  }
  parts.push('')
  for (const t of tasks) {
    parts.push(...taskBodySection(t, names))
  }
  return parts.join('\n') + '\n'
}

/** 单周导出：按天汇总任务 + 周总结（按项目） */
export async function buildWeekMarkdown(
  root: string,
  weekKey: string,
  projectId: string
): Promise<string> {
  const info = getWeekInfoByKey(weekKey)
  if (!info) return `# 周报 ${weekKey}\n\n（周编号无效）\n`

  const [tags, restSet, weekly] = await Promise.all([
    readTags(root),
    readRestMap(root),
    readWeeklySummary(root, weekKey, projectId)
  ])
  const names = tagNameMap(tags)

  const parts: string[] = [`# 周报 ${weekKey}（${info.start} ~ ${info.end}）`, '']
  let any = false
  for (const d of info.dates) {
    const sec = await daySection(root, d, names, restSet, projectId)
    if (sec.length > 0) {
      parts.push(...sec)
      any = true
    }
  }
  if (!any) parts.push('（本周暂无任务记录）', '')

  parts.push('## 周总结', '')
  parts.push(weekly.summary.trim() !== '' ? weekly.summary.trim() : '（未填写周总结）', '')
  return parts.join('\n') + '\n'
}

/** 自定义日期范围导出 */
export async function buildRangeMarkdown(
  root: string,
  start: string,
  end: string,
  projectId?: string
): Promise<string> {
  const [tags, restSet] = await Promise.all([readTags(root), readRestMap(root)])
  const names = tagNameMap(tags)

  const dates = enumerateDates(start, end)
  const parts: string[] = [`# 日志工具 ${start} ~ ${end}`, '']
  let any = false
  for (const d of dates) {
    const sec = await daySection(root, d, names, restSet, projectId)
    if (sec.length > 0) {
      parts.push(...sec)
      any = true
    }
  }
  if (!any) parts.push('（该时间段暂无任务记录）', '')
  return parts.join('\n') + '\n'
}
