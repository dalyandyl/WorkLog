import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { RELEASE_NOTES } from '../data/releaseNotes'
import RichView from './RichView'

/** 简单版本号比较（x.y.z，可带 -beta 后缀）：返回 a - b 的符号 */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da > db ? 1 : -1
  }
  return 0
}

/**
 * 更新公告：展示每个版本发布的新内容（内置数据，随版本维护）。
 * 最新版本默认展开；当前运行版本高亮标注「当前版本」，比当前更新的版本标「新」。
 */
export default function AnnouncementsView() {
  const [appVersion, setAppVersion] = useState('')
  const [openSet, setOpenSet] = useState<Set<string>>(() =>
    new Set(RELEASE_NOTES.length > 0 ? [RELEASE_NOTES[0].version] : [])
  )

  useEffect(() => {
    window.api.getAppInfo().then((info) => setAppVersion(info.appVersion))
  }, [])

  function toggle(version: string): void {
    setOpenSet((prev) => {
      const next = new Set(prev)
      if (next.has(version)) next.delete(version)
      else next.add(version)
      return next
    })
  }

  return (
    <div className="announce-view">
      <div className="date-heading">
        <h2>更新公告</h2>
        <span className="weekday">每个版本发布的新内容</span>
      </div>

      <div className="announce-list">
        {RELEASE_NOTES.map((note) => {
          const isCurrent = appVersion !== '' && note.version === appVersion
          const isNew = appVersion !== '' && compareVersions(note.version, appVersion) > 0
          const open = openSet.has(note.version)
          return (
            <div
              key={note.version}
              className={
                'announce-card' +
                (open ? ' open' : '') +
                (isCurrent ? ' current' : '')
              }
            >
              <button
                type="button"
                className="announce-head"
                onClick={() => toggle(note.version)}
                aria-expanded={open}
              >
                <span className="announce-title">
                  <span className="announce-version">v{note.version}</span>
                  {note.date && <span className="announce-date">{note.date}</span>}
                  {isCurrent && <span className="announce-badge current">当前版本</span>}
                  {isNew && <span className="announce-badge new">新</span>}
                </span>
                <ChevronDown size={16} className={'announce-chev' + (open ? ' open' : '')} />
              </button>
              {open && (
                <div className="announce-body">
                  <RichView content={note.content} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="announce-hint">更新内容内置在应用中，随版本发布同步更新</div>
    </div>
  )
}
