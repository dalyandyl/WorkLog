# WorkLog 前端档案（v1.5.3 只读调研）

> 范围：`src/renderer/src/` 全部 ts/tsx + `assets/main.css` 的分区与变量（未全文读取）。
> 数据来源：实读 33 个源文件；无任何文件被修改。

---

## 1. 导航与页面结构

### 1.1 入口与外壳

`main.tsx:1-14` 极简：`createRoot(#root).render(<App />)`，无 Router、无 Provider、无 ErrorBoundary、无 StrictMode。
副作用仅为字体（Inter latin 4 档 + JetBrains Mono 2 档）与 `assets/main.css`（`main.tsx:5-12`）。

`App.tsx` 是唯一的状态中枢，全局状态全部为 `useState` 放在 `App` 顶部：

| 状态 | 位置 | 说明 |
|---|---|---|
| `date` | `App.tsx:65` | 当前选中日期 `YYYY-MM-DD`，初始今天 |
| `mode` | `App.tsx:66` | 当前页面 key，初始 `'day'` |
| `weekKey` | `App.tsx:67` | 周报键 `YYYY-Www`，初始当前 ISO 周 |
| `daySel` | `App.tsx:68-71` | `{date, taskId}` 日报选中任务；带 date 是为了防止跨日残留选中 |
| `settings` | `App.tsx:72-86` | 主题/强调色/提醒/WebDAV/更新源 |
| `tags` | `App.tsx:87` | 全量标签数组 |
| `taskDates` | `App.tsx:88` | `Set<string>`，日历"有日志"打点 |
| `status` | `App.tsx:89` | 状态栏文案 —— **已无任何读取方，见 §5.1** |
| `settingsOpen` / `calOpen` | `App.tsx:91-92` | 设置弹窗、日历区展开态 |
| `updateBubble` | `App.tsx:94` | 右下角更新气泡状态机 |
| `collapsedGroups` | `App.tsx:101-108` | 导航分组收起态，localStorage `wl-nav-collapsed` 持久化 |

### 1.2 左侧导航

- `Mode` 联合类型定义 10 个页面 key（`App.tsx:35`）。
- `NAV_ITEMS`：10 项，每项 `{key,label,icon,group}`（`App.tsx:44-55`）。
- `NAV_GROUPS`：4 个分组「日志 / 任务 / 分析 / 管理」（`App.tsx:57-62`）。

| 分组 | key | 组件 | 加载方式 |
|---|---|---|---|
| 日志 | `day` | `DayView` | 静态 import（`App.tsx:30`） |
| 日志 | `week` | `WeeklyView` | lazy（`App.tsx:25`） |
| 任务 | `publish` | `TaskPublish` | lazy（`App.tsx:22`） |
| 分析 | `stats` | `StatsView` | lazy（`App.tsx:20`） |
| 分析 | `report` | `ReportView` | lazy（`App.tsx:24`） |
| 管理 | `tags` | `TagManager` | lazy（`App.tsx:21`） |
| 管理 | `sticky` | `StickyNotesView` | lazy（`App.tsx:29`） |
| 管理 | `meeting` | `MeetingList` | lazy（`App.tsx:27`） |
| 管理 | `trash` | `TrashView` | lazy（`App.tsx:23`） |
| 管理 | `announce` | `AnnouncementsView` | lazy（`App.tsx:28`） |

只有 `Calendar`（`App.tsx:17`）、`SearchBox`（`:18`）、`DayView`（`:30`）、`UpdateBubble`（`:31`）是静态引入；其余 8 个 `lazy()` 拆包，意图是 TipTap / KaTeX / 富文本依赖延后进内存（`App.tsx:19` 注释）。

导航渲染：`{NAV_GROUPS.map(...)}` 内层 `NAV_ITEMS.filter(n => n.group === g.name)`（`App.tsx:269`）——每次渲染对 10 项数组做 4 次 filter，量小但属可省开销。分组头 `aria-expanded` 已补（`App.tsx:262`），导航按钮本身**无 aria-current**（`App.tsx:274` 用 `active` class 表达）。

侧栏结构自上而下：品牌头 `topbar`（含 `SearchBox`）→ `sidebar-calendar`（可折叠的 `Calendar`）→ `sidebar-nav`（4 分组）→ `sidebar-bottom`（设置按钮）。

### 1.3 状态如何下传

App 不做 Context，纯 props 下钻，回调即"上行事件"：

- `tags` → `TaskPublish` / `DayView` / `WeeklyView` / `ReportView` / `TagManager` / `MeetingList`（6 处）。
- `date` → `DayView`、`StatsView`。
- `weekKey` → `WeeklyView`（双向：`onWeekChange`）。
- `selectedTaskId` → `DayView`（值受 `daySel.date === date` 守卫，`App.tsx:309`；`onSelectTask` 回写 `App.tsx:310`）。
- `onStatus={setStatus}` → 7 个页面 + SettingsModal（`App.tsx:299,313,323,330,334,338,342,346,360`）。

### 1.4 外围接线

- **日历**：`calOpen` 控制显隐（`App.tsx:251`），`markers={taskDates}`、`onSelect={selectDate}`。`selectDate` 同时做三件事：切日期、清 `daySel.taskId`、强制 `setMode('day')`（`App.tsx:224-228`）。
- **搜索**：`SearchBox onPick={(d, taskId) => {setMode('day'); setDate(d); setDaySel({date:d, taskId})}}`（`App.tsx:240`），即搜索命中直接跳到日报并选中该任务。
- **设置弹窗**：`SettingsModal` 常挂载，用 `open` 控制（`App.tsx:355-361`），`onChange={updateSettings}`；`updateSettings` 做 reminder / webdav 两层的深合并并**在 setState 回调里发 IPC**（`App.tsx:211-222`，含副作用于 updater，见 §5.3）。
- **主题应用**：一个 effect 把 `settings.theme/accent` 写到 `<html>` 的 `data-theme` / `data-accent`（`App.tsx:154-159`）；system 模式只在 settings 变化时读一次 `matchMedia`，**未订阅系统主题变化事件**（见 §5.3）。
- **更新气泡**：`onUpdateEvent` 订阅一次（`App.tsx:119-152`），把 available/progress/downloaded/not-available/error 映射为 `UpdateBubbleState`；`settingsOpenRef` 用于在回调里读最新 `settingsOpen`，避免设置页开着时重复弹泡（`App.tsx:96-99,123`）。
- **视图切换自动展开分组**（`App.tsx:162-176`）：`mode` 变化时若所属分组收起则展开并写 localStorage；带 `eslint-disable exhaustive-deps`。
- **`<main key={mode}>`**（`App.tsx:294`）：key 变化强制整个主区重挂载 —— 这是**隐式状态丢失点**（见 §5.3）。

---

## 2. 组件职责

### 2.1 外壳 / 通用基元

**`Modal.tsx`**（38 行，props：`open/title/width=640/height/onClose/children`）
唯一弹窗基元。`open=false` 返回 null；`open` 时挂 `window` keydown 处理 Escape（`:14-21`）。遮罩 `onMouseDown` 判断 `e.target === e.currentTarget` 才关闭，避免拖选误关（`:26`）。宽高走**内联 style**（`:27`）。无 portal、无 focus trap、无 body 滚动锁、无 `role="dialog"`/`aria-modal`、无初始聚焦。

**`Drawer.tsx`**（37 行，props 同 Modal，`width=560`）
与 Modal 几乎逐行重复，仅换 class（`wl-drawer`）与默认宽度。两文件可合并为一个 `overlay` 基元。

**`DropdownSelect.tsx`**（84 行，props：`value/options/onChange/title/className`）
自绘下拉，替代原生 `<select>` 以拿到圆角弹层。`open` 时挂 document mousedown（外点关闭）+ keydown（Escape）（`:31-45`）。已具备 `aria-haspopup="listbox"` / `aria-expanded` / `role="listbox"` / `role="option"` / `aria-selected`（`:56-69`）—— 全项目可访问性最好的组件。缺：键盘上下键/Tab 在选项间移动、焦点回到按钮。

**`DatePicker.tsx`**（269 行，props：`value/onChange/title/label/minDate/maxDate/portal`）
三级视图 `days/months/years`（`:34`）。`portal` 模式下用 `getBoundingClientRect` 算 fixed 定位并 `createPortal` 到 body（`:65-74,140,266`），解决侧栏裁剪。`open` 时重置视图到今天/选中月（`:55-62`，含 disable）。`minDate/maxDate` 仅作用于日视图（`:176-178`）。左右键 `shiftBy` 手写月份进位（`:96-112`）。月/年网格、`.dp-grid` 单元格每次渲染重建数组（`:116-119`）。

**`SearchBox.tsx`**（74 行，props：`onPick(date,taskId)`）
250ms 防抖调 `window.api.searchTasks`（`:30-34`），结果下拉，`pick` 后清空输入并回调（`:40-44`）。外点关闭（`:15-21`）。无 `role="searchbox"`/label、无键盘上下选择、**无请求序号防乱序**（见 §5.3）。

**`TagPicker.tsx`**（86 行，props：`selectedIds/allTags/onChange/onGoToTags?`）
选中 chip 列表 + "+ 标签" 展开可选菜单 + "管理标签…" 跳转（`:71-81`）。`selected/available` 每次渲染两次 `filter` + `includes`（`:23-24`，O(n·m)）。chip 颜色内联 style（`:41,43`）。

**`RichView.tsx`**（54 行，props：`content`）
Markdown → HTML 的唯一只读渲染出口，`dangerouslySetInnerHTML`（`:51`）。KaTeX **按需动态 import**：仅当 DOM 里存在 `span[data-math]` 才 `import('katex')`（`:11-34`），并用 `cancelled` 防卸载后写入。捕获阶段拦截 `wlattach://` 链接转 `window.api.openAttachment`（`:36-44`）。

**`UpdateBubble.tsx`**（86 行，props：`state/onDownload/onInstall/onRetry/onClose`）
无状态展示组件，四态分支渲染；带 `role="alert" aria-live="polite"`（`:31`）。

**`AboutModal.tsx`**（133 行）—— **死代码**，全项目无 import（见 §5.1）。

### 2.2 日志 / 任务域

**`DayView.tsx`**（358 行，props：`date/tags/selectedTaskId/onSelectTask/onDateChange/onTasksChanged/onStatus/onGoToTags`）
日报主视图。自己加载：`readTasks(date)`（`:49,60`）、`listStickyNotes()` 并过滤 `pinned && !completed`（`:68-71`）。本地态：`tasks`、`stickyNotes`、`postponeTask` 以及一整套行内编辑草稿（`editingTask/editTitle/editBody/editTags/editSubtasks`，`:40-44`）。
调用 API：`readTasks / listStickyNotes / updateStickyNote / updateTask / trashTask`（`:49,60,68,81,88,103,115,137,151,163`）。
关键流程：勾选完成 → 乐观更新并按 `done`+`order` 重排（`:98-102`）→ `updateTask` → `onTasksChanged()`；子任务勾选（`:108-117`）；行内编辑保存后 `onTasksChanged()` 再 `await loadTasks()`（`:131-147`，习惯性双刷);备注独立保存（`:150-155`）；删除走 `window.confirm` 文案已说明"所有天同步"（`:159-161`）；上一/下一天 `shiftDate`（`:172-176`）。
便签区在任务列表上方，勾选/取消置顶都是**先本地乐观移除再发 IPC**，失败不回滚（`:79-90`）。

**`TaskPublish.tsx`**（699 行，props：`tags/onStatus/onPublished/onGoToTags`）
最大的组件，实际包含 2 个组件：`PendingTaskCard`（`:87-186`）+ 默认导出主体。
自己加载：`listPublishHistory()`（`:207,239`）；`refreshPublished()` 先 `listTaskDates()` 再 **`readTasksMany(全部日期)`** 全量拉取并拍平成 `{date,task}[]` 后倒序（`:210-225`）。双击加载（`:206-208` 与 `:227-230` 各一次）。
本地态 12 个：`showForm/pending/history/detail/detailInstances/query/histGran/histDate/pubTab/published/viewEntry/postponeEntry`（`:189-204`）。
调用 API：`listPublishHistory / listTaskDates / readTasksMany / readTasks / updateTask / publishTasks`。
关键流程：批量发布 `publishAll` 逐条 `await publishTasks`，跳过空标题/非法区间并累积 `onStatus`（`:264-302`）；`openDetail` **串行 for-await 逐个 `readTasks`**（`:304-313`）；已发布列表勾选完成（`:232-236`）；延期入口有三处（列表行/详情抽屉/实例列表，`:402,518,640`）。
两个抽屉：`viewEntry`（已发布任务详情，`:512-593`）与 `detail`（发布历史详情，`:595-684`），正文均用 `RichView`。

**`TaskDetail.tsx`**（177 行，props：`task/date/tags/onEdit?/onDelete?/onPostpone?/onUpdateNote?`）
日报右侧只读详情，唯一的自有状态是备注编辑态 `noteEditing/noteDraft`（`:38-39`）。**不直接调 window.api**，全部经回调（`onUpdateNote` 返回 Promise，`:46-50`）。`date`、`tags` 中 `tags` 用 `find` 线性查找每个标签 id（`:80,114`），`date` prop **收到但从未使用**（见 §5.2）。子任务只读渲染用 `CheckSquare/Square` 图标而非 checkbox。

**`SubtaskEditor.tsx`**（119 行，props：内联类型 `{subtasks, tags, onChange}`）
纯受控子任务编辑器，本地仅 `subInput` / `openSubtag`。回车添加、勾选完成、每行标签菜单、删除。`tags.find` 同样是线性查找（`:56`）。

**`PostponeModal.tsx`**（147 行，props：`open/task/entryDate/onClose/onPostponed(added)/onStatus`）
延期流程：打开时 `datesOfTask(task.id)` 取现有区间，默认区间 = 今天起、长度同原区间（`:39-57`，含 disable + `cancelled`）。确认时 `enumerateDates` → `postponeTask(entryDate, task.id, dates)`（`:81`），成功后**切换到"延期成功"结果弹窗**（`:101-117`），点确定才 `onClose` + `onPostponed(added)`（`:94-99`）。`entryDate` 仅作 IPC 锚点。

**`PostponeModal` 依赖的两个工具**：`utils/date.ts` 提供 `toDateStr/weekdayOf/weekInfoOf/enumerateDates/datesByGranularity`（后者在本版本已无调用方）；`weekInfoOf` 与主进程 `storage.getWeekInfo` 约定保持一致（`date.ts:24` 注释）。

**`PostponeModal` 的父级联动**：`DayView` 与 `TaskPublish` 都在 `onPostponed` 里"重载本地 + 通知 App"（`DayView.tsx:350-353`、`TaskPublish.tsx:691-694`）。

**`MarkdownEditor.tsx`**（219 行，props：`value/onChange/attachFolder/placeholder?/onStatus?`）
纯 Markdown textarea，无工具栏，仅两按钮 + 右键菜单（`:178-204`）。粘贴/拖拽图片走 `saveAttachmentImage`（`:56-68`），附件走 `pickAttachmentFiles`（`:70-79`）。`insertAtCursor` / `applyFormat` / `applyList` 都用 `requestAnimationFrame` 恢复光标（`:49,121,147`）。`attachFolder` 决定附件落盘目录，调用方传 `'publish'`（DayView）或 `weekKey`（WeeklyView 周总结）。

**`Calendar.tsx`**（141 行，props：`selected/markers: Set<string>/onSelect`）
侧栏月历。用 `holidays.ts` 的 `loadHolidayYear` 按年懒加载节假日（`:27-35`），`holidayVersion` 仅作"触发器"（`:19,30`）。渲染 `markers.has(d)` → `has-log`、`isRestDay` → `rest`、调休 → `班` 角标（`:101-127`）。"回到今天"同时重置视图年月与 `onSelect(today)`（`:46-51`）；"更新日历"调 `refreshHolidayYear` 并**人为保证转圈至少 800ms**（`:53-66`）。

### 2.3 分析与报告域

**`WeeklyView.tsx`**（278 行，props：`weekKey/tags/onWeekChange/onStatus`）
内含 `DayBlock`（`:27-95`）。自己加载：`getWeekInfoByKey(weekKey)` → `readTasksMany(wi.dates)`（`:109-115`）、`readWeeklySummary(weekKey)`（`:116-120`），带 `cancelled`。周总结输入 **800ms 防抖 `writeWeeklySummary`**（`:128-134`），但无卸载时 flush，也**无保存状态提示**。周切换走 `shiftWeekKey(weekKey, ±1)` 由主进程算（`:136-139`）。任务详情复用 Drawer + RichView（`:213-275`）。

**`StatsView.tsx`**（180 行，props：`date`）
月份区间统计。`range` 由 `date` 初始化（`:19-20`），`date` 变化时 effect 重置（`:33-35`）。数据：`rangeStats(range.start, range.end)`（`:37-45`，带 cancelled）。自绘柱状图 `month-chart`，`maxDaily` 决定高度，`Math.max(12, ...)` 保底 12px、零值 3px（`:49,137`）。卡片四张 + 标签分布。无 chart 库依赖。

**`ReportView.tsx`**（192 行，props：`tags/onStatus`）
报表。`granularity` × `anchor` → `expandReportDates` 展开日期（`utils/report.ts:7-23`），`Promise.all([rangeStats, readTasksMany])` 并发取数（`:55-62`）。Markdown 由 `buildReportMarkdown` 拼装（`utils/report.ts:46-113`）。导出：`exportReportMd`（`:100`）、`exportReportWord`（`:107`，`wordHtml()` 内联一整套 Word 用 CSS，`:85-95`）。预览弹窗 md 用 `<pre>`、word 用 `dangerouslySetInnerHTML`（`:176-189`）。`dates` 有 `useMemo`（`:68`），但 `fullMarkdown` 每次渲染重算（`:75`）。

### 2.4 管理域

**`TagManager.tsx`**（234 行，props：`tags/onChanged/onStatus`）
内含 `TagRow`（`:25-104`）。CRUD 全走 `createTag/renameTag/recolorTag/deleteTag`（`:120,132,143,149`）；`createTag`/`renameTag` 返回 falsy 即表示重名，用 `errorMsg` 弹提示（`:121-124,133-137`）。10 个预设色 + `<input type="color">`（`:12-23,208-214`）。纯前端 `filter` 搜索（`:113-115`）。

**`StickyNotesView.tsx`**（287 行，props：`onStatus`）
便签管理页。`listStickyNotes / addStickyNote / updateStickyNote / deleteStickyNote`。**每次操作后整表 `refresh()` 重拉**（`:37-39,55,60,66,84,93`）。三段分组由三个 `filter` 得出（`:98-100`），`renderNote` / `renderSection` 是**组件内部函数返回 JSX**（`:102,175`），每次渲染重建。概览四卡 + 网格布局。

**`MeetingList.tsx`**（368 行，props：`tags/onStatus?`）
内含 `MeetingDetail`（`:40-118`）。`listMeetings / deleteMeeting / exportMeeting / openAttachment`。筛选与排序**全在前端 useMemo**（`:172-192`），搜索时对每条会议 `stripHtml(m.body)` 建临时 div 取 textContent（`:29-33,178`）——对大正文是实打实的重复解析开销。`byDate` 分组再 useMemo（`:195-203`）。两种视图卡片/时间轴（`:230-268`），时间轴复用同一批操作按钮（重复代码）。
**注意**：`MeetingDetail` 未复用 `RichView`，而是自己 `dangerouslySetInnerHTML` 原文（`:105-109`）+ 自己实现 `wlattach://` 拦截（`:53-61`），与 `RichView.tsx:36-44` 逻辑重复。

**`MeetingEditor.tsx`**（340 行，props：`tags/meeting?/onSave/onClose/onStatus?`）
TipTap 富文本编辑器（唯一重依赖点）：`new Editor({...})` 在挂载 effect 里创建一次（`:56-89`），`StarterKit.configure({codeBlock:false})` + Table/CodeBlockLowlight/Highlight/TextStyle/Color/Image（`:61-74`），卸载 destroy。
附件：`saveMeetingAttachment / pickAttachmentFiles / deleteAttachment / openAttachment / saveMeeting`。图片走 `insertHtml`，`removeAttachment` 用**正则从 HTML 里删除对应 img/a**（`:133-138`，脆弱实现）。`editingIdRef` 用 `useRef(crypto.randomUUID())` 让新建时附件目录也稳定（`:43`）。粘贴/拖拽用 capture 阶段监听 + `uploadImagesRef` 规避闭包（`:109-110,143-170`）。保存前校验标题（`:178-181`）。

**`TrashView.tsx`**（89 行，props：`onStatus/onRestored`）
`listTrash / restoreTrash / removeTrash / clearTrash`，三种破坏性操作都用 `window.confirm`（`:31,39`）。恢复成功同时 `onRestored()` + 本地 `refresh()`（`:21-28`）。

**`AnnouncementsView.tsx`**（90 行，props：**无**）
纯展示内置 `RELEASE_NOTES`（`data/releaseNotes.ts`，3 条）。自带版本比较 `compareVersions`（`:7-17`），用 `getAppInfo()` 拿当前版本以标注"当前版本"/"新"（`:29-31,51-52`）。展开态用 `Set<string>`（`:25-27,33-40`）。带 `aria-expanded`（`:67`）。

### 2.5 设置

**`SettingsModal.tsx`**（387 行，props：`open/settings/onChange/onClose/onStatus`）
5 个 tab：`theme/reminder/backup/sync/about`（`:15-23`）。
`open` 时重置全部内部状态并拉 `getAppInfo()` / `getStorageRoot()`，同时订阅**第二个** `onUpdateEvent`（`:54-94`）——与 App 的订阅并存，App 侧靠 `settingsOpenRef` 让路。
API 覆盖：`backupExport/backupImport/syncPush/syncPull/syncLocalMtime/checkUpdate/downloadUpdate/installUpdate/setUpdateSource`。
`doSyncPull` 有冲突确认逻辑：本地 mtime 晚于 `lastSyncAt` 时先 `window.confirm`（`:123-132`）。
主题：3 个 radio（`:182-199`）；强调色：6 个色块，**这是全项目唯一带 `aria-label` 的图标/色块按钮**（`:202-212`）。更新镜像源选择时会额外 `setUpdateSource`（`:335-339`）。
样式上大量长行内 JSX（`:296-304` 三个 WebDAV 输入全在一行内）。

---

## 3. 数据流与刷新约定

### 3.1 上行回调的三条主线

1. **`onStatus(msg)`** → 全部指向 `setStatus`。约定是"页面把操作结果播报给全局状态栏"。**但状态栏已不存在**（`App.tsx:89` 的 `status` 无处渲染），所以 30+ 条用户可见反馈目前全部静默丢弃。
2. **`onTasksChanged()` / `onPublished()` / `onRestored()`** → 全部指向 `refreshTaskDates()`（`App.tsx:204-206`），唯一效果是重拉 `listTaskDates` 刷新日历打点。
3. **`onChanged()`**（TagManager）→ `refreshTags()`（`App.tsx:207-209`）重拉 `listTags`。

### 3.2 关键传播路径与"谁负责重载"

| 触发 | 本地重载 | 上行 |
|---|---|---|
| DayView 勾选完成/子任务 | 乐观 setState | `onTasksChanged` |
| DayView 编辑保存/删除 | `await loadTasks()` | `onTasksChanged` |
| DayView 延期成功 | `void loadTasks()` | `onTasksChanged` |
| TaskPublish 发布 | `refreshHistory()` + `refreshPublished()` | `onPublished` |
| TaskPublish 勾选完成 | `refreshPublished()` | `onPublished` |
| TaskPublish 延期成功 | `refreshPublished()` | `onPublished` |
| TrashView 恢复 | `refresh()` | `onRestored` |
| TagManager 增删改 | 无（依赖 props `tags` 更新） | `onChanged` |

**结论：刷新是"每个视图各自重拉"的，没有全局 store、没有事件总线、没有缓存失效层。**

### 3.3 重复加载与不同步隐患

- **`TaskPublish` 全量读取最重**：`refreshPublished()` 会 `readTasksMany(所有有任务的日期)`（`:216`），并在挂载 effect 与 `listPublishHistory` 并行发起两次独立请求（`:206-208` 与 `:227-230`），无合并、无 loading 态、无 `cancelled` 守卫 —— 快速切走后再回来可能对已卸载组件 setState。
- **跨视图不同步（真实存在）**：`tags` 只在 TagManager 改时刷新；`DayView` 里若因其它路径改了标签，需重新挂载才会同步。反过来，`TaskPublish` 的 `published` 列表**只在自身挂载与自身操作后刷新**——在 `DayView` 勾选完成任务后切到 `TaskPublish`，因为 `<main key={mode}>` 强制重挂载而侥幸正确；但若将来去掉 key，这里会立刻出现陈旧列表。
- **`DayView` 便签不随便签页同步**：注释说"每次进入日报重新拉取"（`DayView.tsx:67`），依赖的仍是重挂载语义。在便签页标记完成后切回日报确实重挂载，成立；但两个视图之间没有任何显式同步。
- **乐观更新无回滚**：`DayView` 的 `toggleTask`、便签完成/取消置顶（`:79-90`）都是先改本地再发 IPC，IPC 失败不会回退 UI，只会在状态栏（已失效）里留一句话。
- **`onTasksChanged` 语义模糊**：名字暗示"任务变了"，实际只刷新日历打点集合；真正的任务数据刷新由各视图自己做。任何新增视图若以为调它就能更新数据，会直接踩坑。
- **重复刷新**：`DayView.saveEdit` 先 `onTasksChanged()` 再 `await loadTasks()`（`:144-146`）；`TaskPublish.publishAll` 连续调 `refreshHistory()` + `refreshPublished()` + `onPublished()`（`:298-300`）。

---

## 4. 样式架构（`assets/main.css`，5090 行 / 5881 物理行）

### 4.1 变量清单（共 16 个，全部定义于 `:root`）

| 类别 | 变量 | 浅色值 | 深色值（`:966-994`） |
|---|---|---|---|
| 底色 | `--bg` | `#f6f7f9` | `#121316` |
| 面板 | `--panel` | `#ffffff` | `#1c1d22` |
| 描边 | `--border` | `#e4e7eb` | `#2e3038` |
| 正文 | `--text` | `#1f2328` | `#e6e7eb` |
| 次要 | `--muted` | `#6b7280` | `#9aa0aa` |
| 强调 | `--accent` | `#3b82f6` | 提亮（`#60a5fa` 等） |
| 派生 | `--accent-soft` | `color-mix(accent 12%)` | `16%` |
| 派生 | `--accent-ring` | `color-mix(accent 28%)` | 继承 |
| 危险 | `--danger` | `#ef4444` | 继承 |
| 圆角 | `--radius` / `--radius-lg` / `--radius-xl` | 10 / 14 / 18px | 继承 |
| 阴影 | `--shadow-sm/md/lg/card` | 4 档 | 继承 |

（`:1-20` 定义，`:22-40` 强调色预设 6 种，`:966-994` 深色覆盖）

### 4.2 主题切换机制

- **深色**：`<html data-theme="dark">`（由 `App.tsx:157` 写入），CSS 侧只覆盖 6 个基色 + `--accent-soft`（`:966-974`），其余靠变量继承。另有 **22 处** `[data-theme='dark'] .xxx` 针对具体组件打补丁（`:996,1001,1905,2351-2363,2367,2402,3662,4821-4825,5440-5869`），后期功能（便签、延期）补丁最密集。
- **强调色**：`<html data-accent="blue|indigo|violet|green|rose|amber">`（`App.tsx:158`），6 组浅色 + 6 组深色提亮值（`:976-994`）。`--accent-soft` / `--accent-ring` 用 `color-mix` 从 `--accent` **自动派生**，所以新增强调色只需加一行（`:8` 注释明确了这一设计意图）——架构上是本文件最干净的一处。
- 变量体系本身是收敛的：**16 个定义、0 个未使用**；唯一悬空引用是 `--fg`（`:3539` 使用、从未定义）。另外 `App.tsx:295` 引用了**不存在**的 `--text-secondary`（应写 `--muted`）。

### 4.3 顶层分区（37 个 `/* ===== xxx ===== */` 标题，按文件顺序）

基础层（无分区注释）：`:root` 变量 → 滚动条（`:46-80`）→ `html/body/#root` → `.app/.topbar/.body/.sidebar/.main` → `date-heading` → 日历 → `today-btn/loading`。
分区区：

1. `左侧导航` `:387`
2. `日报（任务清单）` `:1094`
3. `标签管理` `:1396`
4. `任务发布` `:1536`
5. `周报` `:1705`
6. `统计（补充）` `:1894`
7. `日期选择器（通用，圆润）` `:1909`
8. `图标按钮（悬浮显示提示；颜色淡化为灰调）` `:1943`
9. `任务详情（两态）` `:1977`
10. `富文本编辑器（TipTap）` `:2000`
11. `发布历史` `:2264`
12. `深色适配（v3 新增部分）` `:2350`
13. `v3.1：日报面板容器` `:2373`
14. `v3.1：弹窗 / 抽屉` `:2406`
15. `v3.1：发布页` `:2552`
16. `v3.1：标签管理行` `:2582`
17. `v3.1：编辑器黄框兜底` `:2596`
18. `v3.2：自定义日期选择器` `:2625`
19. `v3.4：标签搜索 / 发布粒度与搜索` `:2845`
20. `v3.5：子任务` `:2906`
21. `v3.6：关于系统 / 联网更新日历` `:3095`
22. `v3.7：纯 Markdown 编辑器` `:3227`
23. `v3.7：日志报表` `:3325`
24. `v3.7：周报总结弹窗` `:3364`
25. `v3.7：标签重名弹窗` `:3383`
26. `v1.2：项目 / 回收站 / 同步 / 报表` `:3391`
27. `v3.3：通用虚线描边按钮（同新建任务风格）` `:3666`
28. `v1.3：左侧项目菜单栏 / 日历浮层 / 设置弹窗` `:3719`
29. `会议纪要功能样式` `:4201`
30. `会议功能增强样式` `:4481`
31. `第三轮打磨` `:4756`
32. `第四轮：报表控件 + 单选圆点` `:4931`
33. `第五轮：自定义圆角下拉` `:5004`
34. `更新气泡提示（右下角）` `:5111`
35. `更新公告` `:5199`
36. `便签功能` `:5319`
37. `任务延期弹窗` `:5797`

**分区形态本身就是技术债证据**：第 13–37 共 25 个分区以"轮次/版本号"命名且**主题高度交叉**（`v3.1：弹窗/抽屉` 与 `v3.1：发布页` 与 `v3.2：自定义日期选择器` 混在一起）。后写的规则覆盖先写的，形成事实上的层叠补丁链。@media 只有一条 `(max-width: 1000px)`。

### 4.4 内联样式与魔法数字

- CSS 内 `!important` **0 处**（说明层叠虽乱但未靠暴力压制）。
- 动画只有 4 个 keyframes：`wl-fade-in / wl-pop-in / wl-slide-in / wl-spin`。
- 硬编码色值约 **87 行**（未走变量的散装 `#xxxxxx`）。
- tsx 内联 style 约 40 处，分三类：①标签颜色 `{borderColor, color}`（`TaskPublish.tsx` 一处文件内重复 6 次：`:391,471,544,566,607,666`）；②进度条宽度（`UpdateBubble.tsx:57`、`SettingsModal.tsx:374`、`AboutModal.tsx:123` 三份相同实现）；③尺寸 `{width, height}`（`Modal.tsx:27`、`Drawer.tsx:26`）。
- 魔法数字密集处：`TaskPublish.tsx:485` `width={1080} height={680}`、`MeetingList.tsx:350-351` `960×760`、`:334` `620`、`DatePicker.tsx:71` `window.innerWidth - 296`、`Calendar.tsx:63` 的 `800ms` 转圈、`StatsView.tsx:137` 的 `12/64/3` 柱高常量、`WeeklyView.tsx:131` 的 `800ms` 防抖、`SearchBox.tsx:34` 的 `250ms`。

---

## 5. 代码质量观察

### 5.1 死代码 / 失效机制（优先修）

- **状态栏整体失效**：`App.tsx:89` 定义 `status`，9 处传入 `onStatus={setStatus}`，但 **JSX 中无任何一处读取 `status`**。即全项目所有 `onStatus('已保存…')` / `'已发布 N 个任务'` / 错误提示都写进了一个无人订阅的 state。React 甚至会因此触发无意义重渲染。文件 `:19` 注释提到"取消主区底部状态栏"（见 `releaseNotes.ts:35`），说明是删 UI 时漏删链路。
- **`AboutModal.tsx` 完全未被引用**（全仓 `grep` 只命中自身定义）。其功能已被 `SettingsModal` 的 `about` tab 取代（`SettingsModal.tsx:308-382` 与之高度重复），133 行死代码 + 重复的 `onUpdateEvent` 逻辑。
- **`utils/date.ts` 的 `datesByGranularity`**（`:66-117`）在本版本已无调用方（`TaskPublish` 改用 `enumerateDates`）。
- **`PostponeModal` 的 `onPostponed(added)` 参数**被两个父级都忽略（`DayView.tsx:350`、`TaskPublish.tsx:691` 都写成无参箭头）。

### 5.2 未使用变量 / props（会触发 lint 噪音）

- `TaskDetail.tsx:19,32` 的 `date` prop 解构后**从未使用**（`TaskDetail` 内不需要日期），调用方仍传（`DayView.tsx:330`）。
- `TaskPublish.tsx` 的 `histGran/histDate` 有使用，但 `PostponeModal` 的 `entryDate` 在 `TaskPublish.tsx:689` 传 `postponeEntry?.date ?? ''`，当 `postponeEntry` 为 null 时传空串 —— 与 `open=false` 同时成立，暂无 bug，但契约脆弱。
- `App.tsx:65` 的 `date` 与 `:68` `daySel` 双份日期来源存在冗余（`daySel.date` 与 `date` 需手工保持一致，`:309` 用比较来兜底）。
- 8 处 `eslint-disable react-hooks/exhaustive-deps`：`App.tsx:175`、`DatePicker.tsx:61`、`MeetingEditor.tsx:88`、`DayView.tsx:75`、`PostponeModal.tsx:56`、`StickyNotesView.tsx:43`、`TaskPublish.tsx:229`、`WeeklyView.tsx:125`。其中 **`DayView.tsx:56-76` 是真实隐患**：effect 依赖只有 `[date]`，但函数体读了 `selectedTaskId` 与 `onSelectTask`，属于陈旧闭包；`PostponeModal.tsx:39-57` 同理（依赖 `[open, task?.id]` 却读整个 `task`）。
- 全项目 **`any` 使用 0 处**（`grep \bany\b` 只命中注释与 eslint 行），`as unknown`/`@ts-ignore` 均为 0。类型质量实际很好：`window.api` 由 `src/preload/index.d.ts:148-152` 的 `declare global { interface Window { api: WorkLogApi } }` 全局接管，`renderer/src/types.ts` 只是 `shared/types` 的再导出（`:1-25`）。

### 5.3 性能与正确性隐患

- **`<main key={mode}>` 强制重挂载**（`App.tsx:294`）：好处是"切页即重置"，代价是切换视图**丢失全部本地状态**——`TaskPublish` 里已填了一半的 `pending` 草稿、`DayView` 的行内编辑草稿、周报未 flush 的 800ms 防抖写入都会静默丢失（`WeeklyView.tsx:128-134` 卸载时无 flush，虽然 cleanup 清了定时器 `:123`，反而确认了会丢）。同时每次切页都重跑 `readTasksMany` 全量读取。
- **`TaskPublish.refreshPublished` 无界全量读取**（`:210-225`）：`readTasksMany(listTaskDates())` 把**全部历史任务**读进内存并 flatted 成新数组，随后 `.map()` 全量渲染。数据量增长后这是最大的性能点，且无分页/虚拟化。
- **列表全部无虚拟化**：`TaskPublish` 已发布列表（`:365`）、发布历史（`:449`）、`TrashView`（`:62`）、`MeetingList` 卡片与时间轴（`:318,327`）、`StickyNotesView` 网格（`:187`）、`DayView` 任务列表（`:226`）。均为 `.map()` 全量挂 DOM。
- **每次渲染重建大对象/大 Map**：`DayView.tsx:46` `new Map(tags.map(...))`、`TaskPublish.tsx:321` `new Map(...)`（在 699 行组件体顶部，任何 state 变化都重建）、`WeeklyView.tsx:38` `DayBlock` 内 `tagById(tags)`、`:235` 抽屉内又调一次 `tagById(tags)`（同一次渲染内重复建 Map）、`TaskPublish.tsx:323`/`MeetingList.tsx:172` 的 filter 未 memo（`TaskPublish` 的 `filteredHistory` 无 `useMemo`，`ReportView.tsx:75` 的 `fullMarkdown` 每次渲染重算整篇 Markdown）。
- **`MeetingList` 每次搜索对每条会议做 HTML 解析**：`stripHtml` 创建 `document.createElement('div')` 并 `innerHTML`（`:29-33`），被 `:178`（搜索）与 `:231,253`（每张卡片渲染）反复调用，且 `filtered` 的 useMemo 依赖 `query` 每次击键都全量重算。
- **标签徽章渲染代码在 `TaskPublish.tsx` 内重复 6 次**（`:384-397, 464-477, 537-550, 559-572, 600-613, 659-672`），逻辑完全一致（`tagById.get(id)` → `<span className="task-item-tag" style={{borderColor,color}}>`）。同理 `TaskDetail.tsx:79-87,113-126`、`WeeklyView.tsx:68-77,234-246`、`MeetingList.tsx:72-79,215-222` 各有一份 —— 这是全项目最大的一处复制粘贴，应抽 `<TagBadge>`。
- **`MeetingDetail` 绕过 `RichView`**（`MeetingList.tsx:105-109`）：直接 `dangerouslySetInnerHTML={{__html: meeting.body}}`，并重新实现附件点击拦截（`:53-61`）。这既重复代码，也绕过了 `RichView` 里唯一一处统一的附件协议处理。
- **XSS 面（本地应用，风险等级中低但值得记）**：`utils/markdown.ts:4` 用 `new MarkdownIt({html: true})`，即**允许内嵌 HTML 且不做 sanitize**；配合 `RichView.tsx:51` 的 `dangerouslySetInnerHTML`，以及 `MeetingEditor` 保存的原始 TipTap HTML，任何进入 `body` 的 `<script>`/`<img onerror>` 都会在 renderer 里执行。renderer 若有 `nodeIntegration` 则风险显著（本次未读主进程配置，需另行确认 `contextIsolation` / `sandbox`）。
- **`SettingsModal.updateSettings` 在 `setState` updater 内发 IPC**（`App.tsx:211-222`）：React 18/19 的 updater 可能被重复调用，等于可能重复 `setSettings` 到主进程；同时 `TaskPublish.tsx:206-230` 两个 effect 都无 `cancelled` 守卫。属应外提副作用的写法。
- **`SearchBox` 无乱序保护**（`:30-34`）：250ms 防抖后 `await searchTasks(q)` 直接 `setHits`，若两次请求响应顺序颠倒，会显示旧关键词的结果（缺请求序号/AbortController）。
- **`StatsView` 的双 effect 可能互相覆盖**（`:33-35` 与 `:37-45`）：`date` 变化会重置用户自定义区间；且 `date` 只来自 App 的 `date`，用户在统计页手动选月份后，任何 `date` 变化都会把区间拽回去。
- **`Calendar.tsx:19` 用 `useState` 计数器当"重渲染触发器"**（`const [, setHolidayVersion]`）：能工作但属反模式，应改为把数据本身放进 state。
- **`window.confirm` 承担全部破坏性操作确认**（`DayView.tsx:159`、`TrashView.tsx:31,39`、`TagManager.tsx:148`、`MeetingList.tsx:154`、`StickyNotesView.tsx:88`、`SettingsModal.tsx:128`）：Electron 原生对话框在部分平台上会阻塞/样式不一致，且完全无法定制；已有 `Modal` 基元却没用。
- **`MeetingEditor.removeAttachment` 用正则改 HTML**（`:133-138`）：属性顺序、嵌套、转义变化都会漏删或误删，应走 ProseMirror 事务。

### 5.4 可访问性

- **`Modal` / `Drawer` 缺 `role="dialog"`、`aria-modal`、`aria-labelledby`、focus trap、打开时 focus 到弹窗、body 滚动锁**（`Modal.tsx:25-36`、`Drawer.tsx:24-35`）；关闭按钮只有 `title` 没有 `aria-label`（`Modal.tsx:30`）。已做的只有 Escape + 遮罩点击。
- **图标按钮普遍靠 `title` 传达语义**（`title` 不是可靠的可访问名，且触摸设备不显示）：`DayView.tsx:213`、`TaskDetail.tsx:59,64,69,146`、`TrashView.tsx:79`、`TaskPublish.tsx:400,638`、`WeeklyView.tsx:148,155`、`MeetingList.tsx:92,114,244-246`、`StickyNotesView.tsx:129-163`、`SettingsModal.tsx:137,150` 等数十处。反面样本是 `SettingsModal.tsx:209` 与 `:208`（色块带 `aria-label`）—— 说明团队知道怎么做，只是没铺开。
- **导航项无 `aria-current="page"`**（`App.tsx:272-280`）。
- **`SearchBox` 输入框无 `<label>`/`aria-label`/`role="combobox"`/`aria-expanded`/`aria-controls`**，结果列表无 `role="listbox"`，键盘无法上下选择（`:46-72`）。
- **`DropdownSelect` 有完整 ARIA 但无键盘导航**（`DropdownSelect.tsx:62-79`）：`role="listbox"` 下按 ↓/↑/Enter 无效，只能用鼠标点。
- **`MeetingList.tsx:299-304` 的视图切换用裸 `<button>` + `active` class**，无 `aria-pressed`/`role="tablist"`；`TaskPublish.tsx:346-357` 的 tab 同理无 `role="tab"`。
- **`TagManager.tsx:199-207` 的色块按钮无 `aria-label`**（只有 `title={c}` 色值），对比度语义缺失。
- **`RichView` 动态注入 HTML 后无 `lang`/语义兜底**，`ReportView.tsx:180` 的 `<pre>` 预览无代码语义标签（可接受）。

### 5.5 体积与结构

| 文件 | 行数 | 备注 |
|---|---|---|
| `TaskPublish.tsx` | 699 | 单文件 2 组件 + 2 抽屉 + 1 弹窗 + 6 份重复标签渲染 |
| `SettingsModal.tsx` | 387 | 5 tab 全内联在一个 return 里 |
| `App.tsx` | 373 | 10 个 state + 6 个 effect + 全量 props 分发，无自定义 hook 抽取 |
| `MeetingList.tsx` | 368 | 2 组件 + 2 视图 + 筛选排序 |
| `MeetingEditor.tsx` | 340 | TipTap 装配 + 附件 + 工具栏 |
| `DayView.tsx` | 358 | 列表 + 行内编辑 + 详情 + 便签区 + 延期 |
| `StickyNotesView.tsx` | 287 | 内部 render 函数返回 JSX |
| `WeeklyView.tsx` | 278 | 2 组件 |
| `DatePicker.tsx` | 269 | 三级视图 |
| `TagManager.tsx` | 234 | 2 组件 |

**建议的抽取顺序**（按收益/风险比）：① `<TagBadge>`（消除 ~14 份重复）；② 合并 `Modal`/`Drawer` 为一个 overlay 基元并补 focus trap/ARIA；③ 把 `App.tsx` 的 settings/nav/update-bubble 各抽成 hook；④ 把 `TaskPublish` 的"已发布列表/发布历史/两个抽屉"拆文件；⑤ `MeetingDetail` 改用 `RichView`；⑥ 删 `AboutModal.tsx`；⑦ 决定 `status` 状态栏的生与死（要么恢复渲染，要么删掉 `onStatus` 全链路）。

---

## 6. 一句话结论

架构是**"单一 App 状态中枢 + 纯 props 下钻 + 每视图自主重拉"**的直白方案：类型体系干净（0 个 `any`、IPC 全量类型化）、懒加载拆分到位、CSS 变量层（16 变量 / `color-mix` 派生强调色 / `data-theme`+`data-accent`）设计良好；主要债务集中在 **(a) `status` 状态栏链路已死导致所有用户反馈静默**、**(b) `<main key={mode}>` 全量重挂载 + `TaskPublish` 无界全量读取**、**(c) 标签徽章与弹窗基元的成规模复制粘贴**、**(d) `main.css` 25 个"轮次式"补丁分区**、**(e) Modal/Drawer 缺 focus trap 与 `role="dialog"`**。
