import type { ReactElement } from 'react'
import type { Tag } from '../types'

/**
 * 标签徽章。
 *
 * 抽出来的原因：这段「按标签自定义色渲染一个圆角小标签」的逻辑，
 * 改造前在 6 个文件里被复制了 **14 次**（仅 `TaskPublish.tsx` 内就有 6 份），
 * 每次改样式都要动 5 个文件。详见 memory-bank/07-optimization-backlog.md P2-1。
 */

interface TagBadgeProps {
  tag: Tag
  /** 允许调用方覆盖样式类（默认 `task-item-tag`） */
  className?: string
}

export function TagBadge({ tag, className = 'task-item-tag' }: TagBadgeProps): ReactElement {
  return (
    <span className={className} style={{ borderColor: tag.color, color: tag.color }}>
      {tag.name}
    </span>
  )
}

interface TagBadgeListProps {
  /** 标签 id 列表 */
  ids: string[]
  /** 标签 id → Tag 的映射（传 Map 而不是数组：旧实现在每处都做线性 find） */
  tagMap: Map<string, Tag>
  className?: string
  /** 列表容器类名；不传则直接输出徽章（由调用方自带容器） */
  wrapperClassName?: string
}

/**
 * 按 id 列表成批渲染标签徽章。
 * 找不到对应标签的 id 会被静默跳过（与旧实现一致：库里已删除的标签不显示）。
 */
export default function TagBadgeList({
  ids,
  tagMap,
  className,
  wrapperClassName
}: TagBadgeListProps): ReactElement | null {
  if (!ids || ids.length === 0) return null
  const items = ids.map((id) => tagMap.get(id)).filter((t): t is Tag => !!t)
  if (items.length === 0) return null
  const badges = items.map((t) => <TagBadge key={t.id} tag={t} className={className} />)
  if (wrapperClassName) return <div className={wrapperClassName}>{badges}</div>
  return <>{badges}</>
}
