import { useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { Save } from 'lucide-react'
import type { AttachmentMeta, Meeting, StatusReporter, Tag } from '../types'
import TagPicker from './TagPicker'
import DatePicker from './DatePicker'
import RichTextEditor from './RichTextEditor'

interface MeetingEditorProps {
  tags: Tag[]
  meeting?: Meeting | null
  onSave: (meeting: Meeting) => void
  onClose: () => void
  onStatus?: StatusReporter
}

/**
 * 会议编辑器：新建 / 编辑已有会议。
 *
 * 富文本与附件部分已抽到共享的 [`RichTextEditor`](RichTextEditor.tsx)（与日志条目共用同一套 TipTap 装配）；
 * 本组件只保留会议特有的外壳：标题 / 标签 / 日期 / 保存。
 */
export default function MeetingEditor({ tags, meeting, onSave, onClose, onStatus }: MeetingEditorProps) {
  // 新建时也先生成一个固定 id，保证附件目录稳定
  const editingIdRef = useRef(meeting?.id ?? crypto.randomUUID())
  const [date, setDate] = useState(meeting?.date ?? new Date().toISOString().slice(0, 10))
  const [title, setTitle] = useState(meeting?.title ?? '')
  const [selectedTags, setSelectedTags] = useState<string[]>(meeting?.tags ?? [])
  // body 存储 TipTap 编辑器产出的 HTML
  const [bodyHtml, setBodyHtml] = useState(meeting?.body || '<p>开始编辑会议纪要...</p>')
  const [attachments, setAttachments] = useState<AttachmentMeta[]>(meeting?.attachments ?? [])
  const editorInstanceRef = useRef<Editor | null>(null)

  // ---- 保存 ----
  function save(): void {
    if (!title.trim()) {
      onStatus?.('请填写会议标题', 'error')
      return
    }
    const now = new Date().toISOString()
    const data: Meeting = {
      id: editingIdRef.current,
      title: title.trim(),
      date,
      tags: [...selectedTags],
      body: editorInstanceRef.current ? editorInstanceRef.current.getHTML() : bodyHtml,
      attachments,
      createdAt: meeting?.createdAt ?? now,
      updatedAt: now
    }
    window.api.saveMeeting(data).then((r) => {
      if (r.ok) {
        onSave(data)
        onClose()
      } else {
        onStatus?.('保存失败', 'error')
      }
    })
  }

  return (
    <div className="meeting-editor">
      {/* 标题 */}
      <input
        className="meeting-title-input"
        placeholder="会议标题"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
      />

      {/* 标签（与其他界面一致的标准标签选择器） */}
      <TagPicker selectedIds={selectedTags} allTags={tags} onChange={setSelectedTags} />

      {/* 日期 */}
      <div className="meeting-meta-bar">
        <div className="meta-group">
          <label>日期</label>
          <DatePicker value={date} onChange={setDate} title="选择会议日期" />
        </div>
      </div>

      {/* 富文本 + 附件（共享组件） */}
      <RichTextEditor
        initialHtml={bodyHtml}
        attachFolder={`meetings/${editingIdRef.current}`}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        onChange={setBodyHtml}
        editorRef={editorInstanceRef}
        onStatus={onStatus}
      />

      {/* 底部操作 */}
      <div className="meeting-actions">
        <button className="action-btn cancel-btn" onClick={onClose}>取消</button>
        <button className="action-btn save-btn" onClick={save}>
          <Save size={14} /> 保存
        </button>
      </div>
    </div>
  )
}
