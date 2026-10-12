# 04 功能地图（Feature Map）

> 每个功能：**入口组件 / 主进程模块 / IPC / 数据文件 / 关键行为 / 已知问题**。
> 数据结构见 [03-data-model.md](03-data-model.md)，待办编号见 [07-optimization-backlog.md](07-optimization-backlog.md)。

> 🔴 **图片显示缺陷已修复（2026-10-10）**：此前**日报任务正文**与**会议纪要**里插入的图片**都无法显示**，
> 表现为「破图图标 + 文件名」。根因是 `attach:saveImage` 这个 IPC 返回对象 `{url,file}`
> 而 preload 声明为 `string`，渲染层插进模板字符串后变成字面量 `[object Object]`。
> 已在 `src/main/index.ts` 修正为只返回 url，并在 `src/shared/attachmentUrl.ts` 加归一化兜底
> （`npm run test:data` 有回归断言）。**这不是协议或 CSP 问题** —— `wlattach://` 协议链路经隐藏窗口实测完全正常。
> 详细规则见 [06-conventions.md](06-conventions.md) §2「IPC 返回值的类型是未经校验的断言」。

> ⚠️ **「已知问题」字段是 2026-10-10 调研时的快照。** 其中以下条目**已在同日优化批次中修复**，不要再按它们去改代码：
> 日报/全局的 `onStatus` 静默失效（已改 Toast）、任务发布的无界全量读取（已窗口化）、周报卸载丢失防抖写入（已 flush）、
> 标签页 `useCount` 全库扫描（已有天文件缓存）、会议 `saveMeeting` 每次遍历全部会议（已按需扫描）与 `stripHtml` 重复解析（已缓存）、
> 搜索无乱序保护（已加请求序号）、回收站「取出即移除」丢数据（已改为重放成功再删）、
> WebDAV 定时器改设置需重启（已可重配置）、更新下载无超时/无取消（已加看门狗与取消）、托盘 30 秒轮询（已改精确排程）、
> 系统主题不跟随（已订阅 `matchMedia` change）、统计口径不一致与区间任务重复计数（已统一并按 id 去重）、
> `Modal`/`Drawer` 缺焦点陷阱与 `role="dialog"`（已抽出 `Overlay` 统一实现）、标签徽章重复 14 份（已抽出 `TagBadge`）。
> **权威的"已修 / 未修"清单以 [07](07-optimization-backlog.md) 的「已完成」表为准。**

## 0. 日志（journal，2026-10-10 新增；同日改为「一天一篇」）

- **入口**：`components/JournalView.tsx` + 共享的 `components/RichTextEditor.tsx`（**与会议纪要共用同一套 TipTap 装配**）
- **主进程**：`journal.ts`
- **IPC**：`journal:listDates` / `journal:readDay` / `journal:listSummaries` / `journal:saveDay` / `journal:deleteDay`
- **数据**：`journal/<YYYY>/<date>.json`，**一天一篇** `{ date, body, attachments, mountedTasks, createdAt, updatedAt }`
  —— 见 [03](03-data-model.md) §9（含旧 `entries[]` 格式的兼容读法）
- **界面布局**（照用户要求重塑，仿 Word / 备忘录这类写作工具）
  - **左栏**：可滚动的「天列表」，只列**写过的天**，**倒序** + 正文预览 + 关联任务小标记，滚到底「加载更早」（`before` 分页）。
  - **右栏**：一张**居中定宽（780px）的纸**（轻阴影）。
- **读态 / 写态分离**（2026-10-10 按用户反馈重做：此前"一直处于编辑状态"）
  - **默认读态**：渲染后的干净页面（`RichView kind="html"`），**不挂载编辑器**（无工具条、无可编辑区）；
    操作区只有「选择日期 / 关联任务 / **编辑**（空文档时为「开始写」）/ 删除」。
  - **写态**：点「编辑」后挂载 `RichTextEditor`（工具条 + contenteditable），按钮变成「**完成**」；
    关联任务胶囊此时才出现 ✕ 可取消。
  - **编辑器只在「已加载的正是当前日期」后挂载**（`canEdit = mode==='edit' && loadedDate===activeDate && day`）：
    否则切日期时新编辑器会拿**旧一天的内容**挂载。
- **日期自持**（用户要求：取消左上角全局日历的点击跳转）
  - 本页自己管 `activeDate`，**不跟随**左上角日历；点左栏某天只影响本页。
  - 需要外部强行跳转时用 `jumpTo={{ date, nonce }}`（**只在 nonce 变化时生效**）——
    目前唯一的使用者是「全局搜索命中一条日志」。
  - **可手动选任意日期**：头部有 `DatePicker`（复用既有基元），可以挑一个**从未写过**的日期直接开始写；
    那天没有内容时右栏显示明确的空白页 + 「写这一天」入口。
- **关键行为**
  - **自动保存**：仅写态下生效，停止输入 700ms 后落盘；**退出写态 / 切换日期 / 组件卸载**时都会 flush。
    ⚠️ flush 必须通过 `flushRef` 取最新实现 —— `useEffect(..., [])` 的清理闭包会留住**首次渲染**的
    `flush`（那时 `day` 还是 null，会立刻 return false），导致「切页签时保存」**静默失效**。已修。
  - 状态提示：读态显示「已保存」/「还没有内容」，写态显示「保存中…」/「已自动保存」/「编辑中」。
  - **内联图片**：粘贴/拖拽即插入并**直接可见**；表格可视化编辑；非图片附件读态列在正文下方。
  - **关联任务**：选择当天的任务（可多选）→ 只写**快照**（`taskId`/`date`/`title`/`done`，**不抄正文**，按 taskId 去重）。
    点击会**先校验任务是否仍存在**：在则跳到「任务」页并选中，已删除则提示且**文字保留**。
  - 删除是**整天删除**且**先进回收站**（先快照后删除），可恢复。
  - 正文用 TipTap 原始 HTML，渲染时经 `RichView kind="html"`（内部 `sanitizeHtml`，符合铁律 6）。
- **纸张化的实现方式（重要）**：所有「去盒子、放大字号行距」的样式都写在 **`.journal-doc` 作用域**下覆盖，
  **绝不改 `.editor-wrapper` / `.rich-editor-content` 的全局规则** —— 那会同时改掉会议纪要的观感。
- **与任务的关系**：**两个独立的域**。日志不参与任何任务统计；关联是单向、只读、可选。
- **导航**：「日志」组（本页）；「任务」组 = **任务（原「日报」改名）** / 周报 / 任务发布。
- **已知问题**：日历**尚无日志打点**（日历只标记「有任务」）。删除整天时**不做**「内容有改动先提示」的二次确认（已是先存回收站，风险低）。

## 1. 任务（原「日报」，1.5.4 后改名）

- **入口**：`components/DayView.tsx`（358 行）+ `components/TaskDetail.tsx`（177 行）+ `SubtaskEditor.tsx` + `MarkdownEditor.tsx` + `PostponeModal.tsx`
- **主进程**：`tasks.ts`
- **IPC**：`tasks:read` / `tasks:update` / `tasks:trash` / `tasks:postpone` / `tasks:datesOf`、`sticky:list` / `sticky:update`
- **数据**：`<YYYY>/<date>.json`
- **关键行为**
  - 列表按 `sortTasks`（未完成在前，再按 `order`）排列；已完成任务标题置灰 + 对勾。
  - **默认只读**，点 ✏️ 进入**行内编辑模式**（改标题 / 标签 / 子任务 / 正文），💾 保存 / ✕ 取消；无弹窗。
  - 删除走 `window.confirm`（文案已说明「所有天同步」）→ `tasks:trash` 进回收站。
  - 显示**派发时间** `publishedAt` 与**完成时间** `completedAt`。
  - 置顶且未完成的**便签**显示在任务列表上方（可直接勾选完成 / 取消置顶）。
  - 右侧 `TaskDetail` 只读详情，底部**备注独立编辑**（铅笔图标 → textarea → 保存），备注随任务在所有天共享。
- **已知问题**：勾选完成与便签操作是**乐观更新且失败不回滚**；`saveEdit` 先 `onTasksChanged()` 再 `await loadTasks()`（重复刷新）；effect `DayView.tsx:56-76` 只依赖 `[date]` 却读 `selectedTaskId`（陈旧闭包风险）；`TaskDetail` 的 `date` prop 收到但从未使用。

## 2. 任务发布

- **入口**：`components/TaskPublish.tsx`（**699 行，全项目最大组件**，含内部组件 `PendingTaskCard` + 2 个抽屉 + 1 个弹窗）
- **主进程**：`tasks.ts`（`publishTasks` / `postponeTask`）+ `history.ts` + `index.ts` 编排
- **IPC**：`tasks:publish`（同一 handler 内写发布历史）/ `tasks:postpone` / `tasks:update` / `tasks:readMany` / `tasks:listDates` / `history:list` / `history:trash`
- **数据**：多个天文件 + `publish-history.json`
- **关键行为**
  - 批量多任务派发：「待发布列表」逐条填标题 / 标签 / 子任务 / 正文 / 单日或区间，最后统一 `publishAll` 逐条 await。
  - 区间派发 = **同一 task id 写入所选每一天**（详见 [03](03-data-model.md) §4）；任一天完成 / 编辑 / 备注全局同步。
  - **延期**：未完成任务可从三处入口（列表行 / 详情抽屉 / 实例列表）追加自定义新区间；默认今天起、长度与原区间一致；重叠日期自动跳过；成功后弹「延期成功」结果弹窗。
  - 主界面含「已发布任务」与「发布历史」，**只读查看**（点击看详情）；编辑 / 删除统一在日报完成。
- **已知问题**：`refreshPublished()` 用 `readTasksMany(listTaskDates())` 做**无界全量读取**并拍平全部历史任务；挂载期两个 effect 各发一次请求且**无 `cancelled` 守卫**；`openDetail` 串行 `for await readTasks`；列表无虚拟化；标签徽章在本文件内重复 6 次 → P0-6 / P1-2 / P1-4。

## 3. 发布历史

- **入口**：`TaskPublish.tsx` 的历史 tab
- **主进程**：`history.ts`
- **数据**：`publish-history.json` = `{ records: PublishRecord[] }`
- **关键行为**：按**日 / 周 / 月 / 年下拉筛选**并显示范围；点击记录查看详情（含任务实例）；删除整条记录 → 该批全部实例进回收站（`history:trash`，用 `instances` 精确定位，`seenTaskIds` 去重）。

## 4. 周报

- **入口**：`components/WeeklyView.tsx`（278 行，内含 `DayBlock`）
- **主进程**：`weekly.ts` + `storage.ts`（ISO 周）
- **IPC**：`weekly:info` / `weekly:read` / `weekly:write` / `weekly:shift`、`tasks:readMany`
- **数据**：`weekly/<YYYY-Www>.json`
- **关键行为**：按周汇总 7 天任务，显示派发 / 完成时间；已完成置灰 + 对勾；周总结弹窗纯 Markdown，**800ms 防抖自动保存**；周切换由主进程 `shiftWeekKey` 计算。
- **已知问题**：周总结**卸载时无 flush**，配合 `<main key={mode}>` 重挂载会静默丢失最后 800ms 的输入；无保存状态提示。

## 5. 报表

- **入口**：`components/ReportView.tsx`（192 行）+ `utils/report.ts`（日期展开 + Markdown 拼装 + Word HTML 模板）
- **主进程**：`stats.ts` + `tasks.ts`（读任务）+ `exporter.ts`
- **IPC**：`stats:range` / `tasks:readMany` / `report:exportMd` / `report:exportWord`
- **关键行为**：日 / 周 / 月 / 年下拉粒度 + 范围显示；汇总 + 明细（含派发 / 完成时间与备注）；实时预览；导出 **Markdown**（`.md`）与 **Word**（以 HTML 内容存为 `.doc`，Word / WPS 可直接打开）；各有预览「小眼睛」，可分别导出汇总 / 明细 / 汇总 + 明细。
- **已知问题**：`fullMarkdown` 每次渲染重算整篇；预览用 `dangerouslySetInnerHTML`。

## 6. 统计

- **入口**：`components/StatsView.tsx`（180 行，**自绘柱状图，无图表库依赖**）
- **主进程**：`stats.ts` → `rangeStats(start, end)`（复用 `MonthStats` 结构表示任意区间）
- **关键行为**：月份区间由 `App.date` 初始化；四张统计卡 + 柱状图 + 标签分布。
- **已知问题**：`date` 变化会把用户手动选的区间拽回去；`totalTasks` 把区间共享任务的**每天副本重复计数**；只统计任务级标签，**忽略子任务标签**（而 `tags.ts` 的 `useCount` 统计子任务 → 同一概念两处口径不一致）。

## 7. 标签

- **入口**：`components/TagManager.tsx`（234 行，含 `TagRow`）+ `TagPicker.tsx`
- **主进程**：`tags.ts`
- **IPC**：`tags:list` / `create` / `rename` / `recolor` / `delete`
- **数据**：`tags.json`（**裸数组**）
- **关键行为**：全局标签库，列表显示**创建时间**与**使用次数**；10 个预设色 + 原生取色器；重名时 `create`/`rename` 返回 `null`，前端弹提示；删除标签会联动清除**所有任务与子任务**上的引用（`removeTagFromAllTasks`）。
- **已知问题**：`listTags` 的 `useCount` 每次打开标签页都做一次**全库扫描**；`TagPicker` 每渲染两次 `filter + includes`（O(n·m)）；色块按钮无 `aria-label`。

## 8. 便签

- **入口**：`components/StickyNotesView.tsx`（287 行）+ `DayView` 顶部便签区
- **主进程**：`stickyNotes.ts`（**唯一带串行写锁的模块**）
- **IPC**：`sticky:list` / `add` / `update` / `delete`
- **数据**：`stickyNotes.json`（**裸数组**）
- **关键行为**：`pinned && !completed` 的便签显示在每天日报任务列表上方，直到标记完成；未置顶只在便签页可见；完成后保留在「已完成」可恢复；完整参与备份与 WebDAV 同步；**不参与**全局搜索 / 统计 / 报表 / 导出。
- **已知问题**：每次操作后整表 `refresh()`；列表无虚拟化；内部 `renderNote` / `renderSection` 是组件内函数返回 JSX，每次渲染重建。

## 9. 会议纪要

- **入口**：`components/MeetingList.tsx`（368 行，含 `MeetingDetail`）+ `MeetingEditor.tsx`（340 行，**唯一 TipTap 重依赖点**）
- **主进程**：`meetings.ts` + `meetingExport.ts` + `attachments.ts`
- **IPC**：`meetings:list` / `save` / `delete` / `export`、`attach:*`、preload 组合封装 `saveMeetingAttachment`（转发 `attach:saveImage`，folder 传 `meetings/<meetingId>`）
- **数据**：`meetings/<id>.md.json`（**单对象**）+ `attachments/meetings/<id>/`
- **关键行为**：新建 / 编辑 / 删除；TipTap 富文本（StarterKit + Table + CodeBlockLowlight + Highlight + TextStyle/Color + Image）；标签复用全局标签库；图片与文件附件（粘贴 / 拖拽 / 选择）；单篇导出 Markdown（turndown + gfm，`wlattach://` 转为相对路径）。
- **已知问题**：`MeetingDetail` **绕过 `RichView`** 自行 `dangerouslySetInnerHTML` 并重复实现附件拦截；`stripHtml` 每条会议 / 每次击键都 `createElement + innerHTML`；`removeAttachment` 用**正则改 HTML**（脆弱）；`saveMeeting` **每次保存都遍历目录解析所有会议文件**；`MeetingList` 静态 import `MeetingEditor` → 点开「会议」即加载 1.35MB chunk。

## 10. 全局搜索

- **入口**：`components/SearchBox.tsx`（74 行，250ms 防抖）
- **主进程**：`search.ts`
- **IPC**：`search:tasks`
- **关键行为**：命中标题 / 正文 / 子任务标题 / **标签名**；点击结果跳到日报并选中该任务；最多 50 条，按日期倒序。
- **已知问题**：**无请求序号 / AbortController**，响应乱序会显示旧关键词结果；无 `role="combobox"` / label；不支持键盘上下选择；`hits.splice(0, hits.length - 50)` 是**空操作**（应为 `break`）；正则去 HTML 会误删正文里的 `<` `>`。

## 11. 临时回收站

- **入口**：`components/TrashView.tsx`（89 行）
- **主进程**：`trash.ts` + `tasks.ts`（`restoreTasksToDays`）
- **IPC**：`trash:list` / `restore` / `remove` / `clear`
- **数据**：`trash.json` = `{ items: TrashItem[] }`
- **关键行为**：删除的发布任务先整批进回收站，可整批恢复或永久删除 / 清空；条目显示删除时间与包含的任务实例数。
- **已知问题**：**恢复是「重放」**（重新分配 `order`，原位置丢失，不检查 id 是否已存在）；`takeTrashItem` 取出即移除，恢复失败即永久丢失；`trash.json` 无容量上限。

## 12. 日历

- **入口**：`components/Calendar.tsx`（141 行）+ `utils/holidays.ts`
- **IPC**：`holiday:fetch`（主进程 `net.fetch` `https://timor.tech/api/holiday/year/<year>`）
- **关键行为**：侧栏可折叠月历；按年**联网同步法定节假日**，懒加载；标红休息日、调休显示「班」角标；「回到今天」；「更新日历」手动刷新（人为保证转圈 ≥800ms）。
- **已知问题**：`useState` 计数器当重渲染触发器（反模式）；节假日接口无缓存失效策略。

## 13. 设置 · 数据备份 / 跨设备同步

- **入口**：`components/SettingsModal.tsx`（387 行，5 个 tab：`theme` / `reminder` / `backup` / `sync` / `about`）
- **主进程**：`backup.ts` + `sync.ts` + `meta.ts`
- **IPC**：`backup:export` / `backup:import` / `sync:push` / `sync:pull` / `sync:localMtime` / `settings:get` / `settings:set`
- **数据**：整目录 zip；WebDAV 远端固定 `worklog-logs.zip`
- **关键行为**
  - 备份导入导出（zip）；导入后 `resetMigration` 以便旧格式重新升级。
  - 内置 **WebDAV** 同步（如坚果云）：一键上传 / 下载；可设**自动同步**（启动拉取 / 退出上传 / 定时）；显示最近同步时间；**下载前冲突提示**（本地 mtime 晚于 `lastSyncAt` 时 `window.confirm`）。
- **已知问题**：`importBackup` 是**合并覆盖**，不删本地独有文件，无冲突检测；**WebDAV 的 `autoMode` / `intervalMinutes` 变更不会重建定时器**（`scheduleAutoSync` 只启动一次），改间隔需重启；`before-quit` 异步 `preventDefault` 存在丢同步窗口；同步包内含**明文 WebDAV 密码**。

## 14. 更新公告

- **入口**：`components/AnnouncementsView.tsx`（90 行，无 props）
- **数据**：`data/releaseNotes.ts` 内置 `RELEASE_NOTES` 数组
- **关键行为**：展示每个版本发布的新内容，标注「当前版本」/「新」；自带 `compareVersions`。
- **维护要求**：每次发版必须**手工**把新章节加到数组**最前面**（与 `CHANGELOG.md` 保持一致）。

## 15. 关于与自动更新

- **入口**：`SettingsModal` 的 `about` tab（`AboutModal.tsx` 133 行是**未被引用的死代码**，功能已被取代）+ `components/UpdateBubble.tsx`（右下角气泡）
- **主进程**：`updater.ts` + `updater-config.ts`
- **IPC**：`app:getInfo` / `update:check` / `update:download` / `update:install` / `update:set-source` + 事件通道 `update:event`
- **关键行为**：系统信息 + 作者 LHQ；**Gitee / GitHub 双镜像源**自动更新（检测 → 下载 → sha512 校验 → 拉起安装程序），可在设置中选择镜像源（`auto` = Gitee 优先、失败回退 GitHub）；启动时自动检测，发现新版本弹右下角气泡（含进度、重启安装）。
- **已知问题**：`resolveUpdatePlan` 在 check 与 download 各执行一次（间隙远端可变）；下载**无超时 / 无取消**（`net.fetch` 无 AbortSignal）；安装无签名校验、无回滚；`updater-config.ts` 明文 token 随包分发。

## 16. 托盘与每日提醒

- **入口**：`SettingsModal` 的 `reminder` tab
- **主进程**：`tray.ts` + `meta.ts`
- **关键行为**：托盘图标（运行时用 zlib **自绘 PNG**，含手写 CRC32，无图片资源依赖）；关闭窗口 = 最小化到托盘；`setInterval` **每 30 秒**读一次 `settings.json`，命中 `HH:MM` 且当天未提醒过则发系统通知。
- **已知问题**：30 秒轮询 + 每次读盘；`lastFired` 是模块级变量，无停止 / 重配置句柄；若 `HH:MM` 过后才开启设置，当天不再提醒。

## 17. 主题与外观

- **入口**：`SettingsModal` 的 `theme` tab + `App.tsx` 的 `<html>` 属性 effect
- **关键行为**：主题三选（浅色 / 深色 / 跟随系统）；**界面强调色 6 种**可持久化；导航分组收起状态持久化在 localStorage `wl-nav-collapsed`。
- **已知问题**：跟随系统模式**不响应系统主题变化事件**（只在 settings 变化时读一次 `matchMedia`）。

## 18. 已移除的功能（避免误找）

| 功能 | 状态 | 说明 |
|---|---|---|
| 项目结构层级 / `projectId` | 已取消（1.3 前） | 字段保留但忽略；`migrate.ts` 会从发布记录中删除 `projectIds` |
| 任务「休息日」标记 | **已删除（1.5.4 在制品）** | 原 `rest:get` / `rest:set` IPC、`R/rest.json`、日报勾选框、周报「休息日」徽标、`main.css` 的 `.rest-toggle` / `.weekly-rest` / `.cal-refresh-msg` 全部移除。日历中按法定假日的休息日标红是**另一套无关逻辑**（`utils/holidays.ts`） |
| 底部状态栏 | 已删除（1.5.1） | **但 `onStatus` 链路没删干净 → 见 [07](07-optimization-backlog.md) P0-1** |
| `AboutModal.tsx` | 死代码 | 全仓无 import，功能被 `SettingsModal` 的 about tab 取代 |
