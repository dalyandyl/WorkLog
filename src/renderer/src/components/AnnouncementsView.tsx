import { useEffect, useRef, useState, type CSSProperties } from 'react'
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
 * 更新公告：左侧一条时间线，右侧每条版本的内容。
 * 最新版本默认展开；当前运行版本标「当前版本」，比当前新的标「新」。
 */
export default function AnnouncementsView() {
  const [appVersion, setAppVersion] = useState('')
  const [openSet, setOpenSet] = useState<Set<string>>(() =>
    new Set(RELEASE_NOTES.length > 0 ? [RELEASE_NOTES[0].version] : [])
  )
  const [active, setActive] = useState<string>(RELEASE_NOTES[0]?.version ?? '')
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})

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
    setActive(version)
  }

  /** 侧边栏点击：展开并把对应条目滚到可视区顶部 */
  function jump(version: string): void {
    setActive(version)
    setOpenSet((prev) => new Set(prev).add(version))
    requestAnimationFrame(() => {
      itemRefs.current[version]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  function versionOf(note: { version: string }): { isCurrent: boolean; isNew: boolean } {
    // 只有版本号同属一个大版本时才比较：开发模式/截图工具里 app.getVersion() 拿到的是
    // Electron 自己的版本（如 44.0.0），不能拿它去和 1.5.x 比，否则每个版本都会被标成「新」。
    const comparable = appVersion !== '' && appVersion.split('.')[0] === note.version.split('.')[0]
    return {
      isCurrent: comparable && note.version === appVersion,
      isNew: comparable && compareVersions(note.version, appVersion) > 0
    }
  }

  return (
    <div className="announce-view">
      <header className="workhead">
        <div className="wh-left">
          <span className="wh-title wh-title--hero">更新公告</span>
        </div>
      </header>

      <div className="with-side">
        <aside className="page-side">
          <div className="ps-head">
            <span>版本</span>
            <span className="ps-count">{RELEASE_NOTES.length}</span>
          </div>
          <div className="ps-list">
            {RELEASE_NOTES.map((note) => {
              const { isCurrent, isNew } = versionOf(note)
              return (
                <button
                  key={note.version}
                  className={'ps-item' + (active === note.version ? ' on' : '')}
                  onClick={() => jump(note.version)}
                >
                  <span className="ps-item-name">v{note.version}</span>
                  {isCurrent && <span className="pill pill--accent">当前</span>}
                  {isNew && <span className="pill pill--warn">新</span>}
                  <span className="ps-item-meta">{note.date ?? ''}</span>
                </button>
              )
            })}
          </div>
        </aside>

        <div className="page-main">
          <div className="workscroll">
            <div className="tl">
              {RELEASE_NOTES.map((note) => {
                const { isCurrent, isNew } = versionOf(note)
                const open = openSet.has(note.version)
                return (
                  <div
                    key={note.version}
                    ref={(el) => {
                      itemRefs.current[note.version] = el
                    }}
                    className={
                      'tl-item' +
                      (open ? ' open' : '') +
                      (isCurrent ? ' current' : '') +
                      (active === note.version ? ' active' : '')
                    }
                  >
                    <span className="tl-dot" />
                    <div className="tl-card">
                      <button
                        type="button"
                        className="tl-head"
                        onClick={() => toggle(note.version)}
                        aria-expanded={open}
                      >
                        <span className="tl-ver">v{note.version}</span>
                        {note.date && <span className="tl-date">{note.date}</span>}
                        {isCurrent && <span className="pill pill--accent">当前版本</span>}
                        {isNew && <span className="pill pill--warn">新</span>}
                        <ChevronDown size={15} className={'tl-chev' + (open ? ' open' : '')} />
                      </button>
                      {open && (
                        <div className="tl-body">
                          <RichView content={note.content} />
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
