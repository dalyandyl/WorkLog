import type { CSSProperties } from 'react'
import { CalendarDays, Check, CheckCircle2, StickyNote } from 'lucide-react'
import type { Tag, Task } from '../types'
import RichView from './RichView'

interface PartProps {
  task: Task
  tags: Tag[]
}

/** 正文里的纯文本字数（粗略，够用） */
export function bodyChars(html: string): number {
  const text = html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, '')
  return text.length
}

/** 主栏：标题 + 标签 + 正文 + 底部信息 */
export function TaskDetailMain({ task, tags }: PartProps) {
  return (
    <>
      <div className="td-head">
        <h2 className={'td-title' + (task.done ? ' done' : '')}>{task.title || '（未命名）'}</h2>
        <span className={'pill ' + (task.done ? 'pill--ok' : 'pill--accent')}>
          <i />
          {task.done ? '已完成' : '进行中'}
        </span>
      </div>

      <div className="td-tags">
        {task.tags.length === 0 ? (
          <span className="muted" style={{ fontSize: 11.5 }}>
            无标签
          </span>
        ) : (
          task.tags.map((id) => {
            const t = tags.find((x) => x.id === id)
            if (!t) return null
            return (
              <span key={id} className="tag" style={{ '--c': t.color } as CSSProperties}>
                {t.name}
              </span>
            )
          })
        )}
      </div>

      <div className="td-body">
        {task.body ? (
          <RichView content={task.body} />
        ) : (
          <div className="muted" style={{ fontSize: 12.5, paddingTop: 4 }}>
            还没有正文，点右上角「编辑」写点什么。
          </div>
        )}
      </div>

      <div className="td-foot">
        <span>
          <CalendarDays />
          派发 {new Date(task.publishedAt).toLocaleString()}
        </span>
        {task.completedAt && (
          <span>
            <CheckCircle2 />
            完成 {new Date(task.completedAt).toLocaleString()}
          </span>
        )}
        <div className="spacer" />
        <span className="num">{bodyChars(task.body).toLocaleString()} 字</span>
      </div>
    </>
  )
}

interface AsideProps extends PartProps {
  onToggleSubtask: (subtaskId: string) => void
  /** 备注直接可改（停手自动保存）；不传则只读 */
  onChangeNote?: (value: string) => void
}

/** 右栏：子任务 + 备注 + 元信息 */
export function TaskDetailAside({ task, tags, onToggleSubtask, onChangeNote }: AsideProps) {
  const subtasks = task.subtasks ?? []
  const doneCount = subtasks.filter((s) => s.done).length

  return (
    <>
      {subtasks.length > 0 && (
        <div className="side-sec">
          <h4>
            子任务 · {doneCount} / {subtasks.length}
          </h4>
          {subtasks.map((st) => (
            <div key={st.id} className={'subrow' + (st.done ? ' done' : '')}>
              <button
                className={'cbox round' + (st.done ? ' on' : '')}
                title={st.done ? '取消完成' : '标记完成'}
                onClick={() => onToggleSubtask(st.id)}
              >
                <Check />
              </button>
              <span className="t">{st.title || '（未命名）'}</span>
              {st.tags.map((id) => {
                const t = tags.find((x) => x.id === id)
                if (!t) return null
                return (
                  <span key={id} className="tag" style={{ '--c': t.color } as CSSProperties}>
                    {t.name}
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {onChangeNote ? (
        <div className="side-sec">
          <h4>
            <StickyNote />
            备注
          </h4>
          <textarea
            className="side-note-input"
            placeholder="给这个任务写点备注…（停手自动保存，所有天共享）"
            value={task.note ?? ''}
            onChange={(e) => onChangeNote(e.target.value)}
          />
        </div>
      ) : (
        task.note &&
        task.note.trim() && (
          <div className="side-sec">
            <h4>
              <StickyNote />
              备注
            </h4>
            <div className="side-note">{task.note}</div>
          </div>
        )
      )}

      <div className="side-sec">
        <h4>元信息</h4>
        <div className="kv">
          <span>派发时间</span>
          <b>{new Date(task.publishedAt).toLocaleDateString()}</b>
        </div>
        {task.completedAt && (
          <div className="kv">
            <span>完成时间</span>
            <b>{new Date(task.completedAt).toLocaleDateString()}</b>
          </div>
        )}
        <div className="kv">
          <span>正文</span>
          <b>{bodyChars(task.body).toLocaleString()} 字</b>
        </div>
        <div className="kv">
          <span>子任务</span>
          <b>
            {doneCount} / {subtasks.length}
          </b>
        </div>
      </div>
    </>
  )
}
