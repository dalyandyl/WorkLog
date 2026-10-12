# 07 优化待办清单（Optimization Backlog）

> 在制品收尾后进入本阶段（见 [05-progress.md](05-progress.md) §5）。
> 每条含**证据（file:line）→ 影响 → 建议方案 → 工作量 → 验证方式**。
> 工作量：`XS` <10 行 / `S` 半天内 / `M` 1–2 天 / `L` 3 天以上。

## ⚠️ 当前进度（2026-10-10）

**1.5.4 已发布**（Gitee + GitHub，`17076a7`）。P0–P3 的**可执行项全部完成**，
唯一例外是 **P2-5 的「物理重排 + 硬编码色值替换」** ——
该项自身的验证要求是「浅色/深色 × 6 强调色逐页目视对比」，当前环境没有视觉回归手段，
且其安全子集（分区改名 + 索引注释 + 修悬空变量）已按本条自己的建议完成。详见该条目的「⛔ 刻意未做」说明。
逐项完成情况见文末[「已完成」](#已完成)表。

验证手段（本轮新增）：
- `npm run typecheck` / `npm run build` 必须 exit 0（沿用）；
- **`npm run test:data`** —— 数据层集成测试（18 项断言，覆盖跨天同步、索引正确性、损坏文件隔离、原子写、并发写不丢更新）。改动 `src/main` 数据层后**必须**跑。
- `npm run size` —— 安装包体积守卫（超 98MB 直接失败），打包后跑。

---

## P0 —— 数据安全与功能失效（先做，收益最高）

### P0-1 修复 `status` 链路：所有用户反馈目前静默丢失

- **证据**：`App.tsx:89` 定义 `const [status, setStatus] = useState('加载中…')`，9 处传 `onStatus={setStatus}`（`App.tsx:299,313,323,330,334,338,342,346,360`），但**整个 JSX 中没有任何一处读取 `status`**。已用 grep 双向确认。
- **影响**：全项目 30+ 条用户可见反馈（「已保存」「已发布 N 个任务」「备注已保存（所有天同步）」以及**全部错误提示**）都写进一个无人订阅的 state。设置页的同步失败、备份失败、更新失败等信息用户完全看不到。这正是「取消主区底部状态栏」（`releaseNotes.ts:35`）时漏删链路造成的。
- **建议方案**（二选一，需先定案）：
  - **A（推荐）** 改为轻量 Toast：新建 `components/Toast.tsx`，`App` 持 `toasts[]`，`pushStatus(msg, level)` 替代 `setStatus`。理由：底部状态栏已被刻意移除，恢复它会与 1.5.1 的设计决定冲突；Toast 对错误提示更显眼。顺带把 `onStatus` 改名 `onNotify` 或分拆 `onError`。
  - **B** 恢复一个极简底部状态条（固定 1 行、自动淡出）。改动最小但回退了 1.5.1 的界面决定。
- **注意**：定案前**不要新增 `onStatus` 调用**。
- **工作量**：M（A）/ XS（B）
- **验证**：触发一次保存、一次发布、一次同步失败（故意填错 WebDAV 密码），确认三类消息都可见且不阻塞操作；确认 `status` 变量本身不再存在。

### P0-2 写盘原子化 + 读失败不得静默当空（最高数据风险）

- **证据**：
  - 所有写入都是直接覆盖：`tasks.ts:46`（`writeTasks`）、`tags.ts:26`、`trash.ts:21`、`weekly.ts`、`history.ts`、`meetings.ts` —— 无「临时文件 + `fs.rename`」、无 fsync。
  - 读取失败一律静默返回空：`tasks.ts:34-36`、`tags.ts:19-21`、`trash.ts:14-16`；`meetings.ts:43-45` 仅 `console.error` 后跳过。
- **影响**：进程崩溃 / 断电留下截断 JSON → 下次读取被当成「当天无任务」→ **下一次写入即永久覆盖真实数据**。这是全项目破坏性最强的失败模式，且发生在用户毫无感知的情况下（还叠加 P0-1 让报错也看不见）。
- **建议方案**：
  1. 抽 `src/main/jsonStore.ts`：`readJson<T>(path, fallback)` / `writeJsonAtomic(path, data)`。
     - 写入：写 `<path>.tmp` → `fs.rename` 覆盖（同盘 rename 在 Windows 上对已存在目标需 `fs.rm` 或使用 `fs.rename` 的覆盖语义，注意实测）；可选 `fh.sync()`。
     - 读取：区分 `ENOENT`（正常空）与 `SyntaxError` / 其它 IO 错误；后者**抛出或回传给 IPC 让 UI 报错**，绝不返回空数组。
  2. 逐步替换各模块的私有 `readJson` / `writeJson` 副本（现存至少 8 处样板，见 P2-6）。
  3. 天文件「空数组即删除」的策略保留，但配合第 1 步后不再与「读失败」混淆。
- **工作量**：M（helper）+ M（逐模块替换与验证）
- **验证**：写一个手工破坏测试 —— 把某个 `logs/2026/*.json` 截断一半，启动应用，确认①界面明确报错而非显示「当天无任务」；②该文件**不会**被后续任何操作覆盖。再验证正常读写路径与备份导入导出不受影响。

### P0-3 并发写竞态：`tasks` / `tags` / `trash` 全部无锁

- **证据**：仅 `stickyNotes.ts` 实现了串行锁（`withNotesLock`）。`tasks.ts` / `tags.ts` / `trash.ts` 均为 read-modify-write 无锁。渲染层可并发 `invoke`（如快速连点勾选完成，同时标签删除联动 `removeTagFromAllTasks` 改同一批天文件；`SettingsModal` 的 `updateSettings` 甚至在 setState updater 内发 IPC，`App.tsx:211-222`，updater 可能被重复调用 → 重复写盘）。
- **影响**：经典丢更新 —— 两次操作各自读到旧快照，后写者覆盖先写者。用户表现为「勾了但没勾上」「改了但没保存」。
- **建议方案**：
  1. 把 `stickyNotes.ts` 的 `withLock(key, fn)` 提升为共享工具（`src/main/lock.ts`），以**文件路径或任务 id 为 key** 做串行化；
  2. 对「同一任务跨天批量写」用**任务 id 级锁**，对「单文件全量重写」用**文件级锁**；
  3. 顺手把 `App.tsx:211-222` 的 IPC 副作用移出 `setState` updater（改为先算 `next` 再 `setSettings(next)` + `window.api.setSettings(next)`）。
- **工作量**：M
- **验证**：连续快速点击同一任务勾选框 10 次，确认最终状态与最后一次点击一致；用 `Promise.all` 并发调用 `tags:delete` 与 `tasks:update`，确认无数据丢失。

### P0-4 `search.ts` 的 50 条裁剪是空操作

- **证据**：`search.ts:61-63` `hits.splice(0, hits.length - 50)` —— 当 `hits.length >= 50` 时参数为 0 或正数但意图是裁剪；实际在 `hits.length === 50` 时 `splice(0, 0)` 移除 0 个元素。随后 `:67` `hits.reverse()` 反转**整个**已累积列表（可达全库命中数），`:68` 才 `slice(0, 50)`。
- **影响**：语义歧义 + 无谓的全库扫描与内存占用（仍会扫完所有日期文件）。同时结果顺序依赖 reverse，难以推理。
- **建议方案**：改为「命中满 50 条即 `break`」，并明确排序语义（若要按日期倒序，就**从最新日期往前遍历**而不是先正序收集再 reverse）。
- **工作量**：XS
- **验证**：构造 100+ 命中的查询，确认返回 50 条、顺序符合预期，并用 `console.time` 确认不再扫完全库。

---

## P1 —— 性能

### P1-1 `datesOfTask` 全库扫描：每次任务操作都是 O(总天数) 次文件读

- **证据**：`tasks.ts:120-128` `datesOfTask` = `listDatesWithTasks()`（遍历 R 一级目录 + 文件名正则）再对**每个日期** `readTasks`（全量 JSON 解析）。而 `updateTask:106` 紧接着又对命中日期各 `readTasks` 一次（**重复解析**）。调用方包括每次勾选完成、改标题、改备注、删除任务，以及 `tasks:trash` / `history:trash`。
- **影响**：这是本项目**最大性能瓶颈**，且随使用年限线性恶化。3 年数据（约 1000 个天文件）时，一次勾选 ≈ 1000 次文件读 + JSON 解析。
- **建议方案**（按投入递增）：
  1. **低成本**：`updateTask` 内合并两次读取（`datesOfTask` 直接返回 `{date, tasks}`，避免二次 `readTasks`）；`listDatesWithTasks` 结果加进程内缓存 + 写入时失效。
  2. **中成本（推荐）**：维护 `R/.index/task-dates.json` 索引（`{ taskId: string[] }`），在 `publishTasks` / `postponeTask` / `deleteTask` / `restoreTasksToDays` 时增量维护；启动时若索引缺失或 `migrate` 标记变化则重建一次。索引是**派生数据**，损坏可重建，因此无需纳入备份（或纳入亦可）。
  3. **替代方案**：复用 `publish-history.json` 的 `instances` 定位日期，仅在查不到时回退全库扫描。改动最小但语义上不完整（回收站恢复、手工建的任务可能不在历史里）。
- **工作量**：S（方案 1） / L（方案 2）
- **验证**：在 `logs/` 造出 500+ 天数据，测量 `tasks:update` 耗时；改造后应下降到个位数毫秒级。同时回归：区间任务的编辑 / 删除 / 延期 / 回收站恢复是否仍跨天同步。

### P1-2 `TaskPublish` 无界全量读取 + 双请求 + 无取消守卫

- **证据**：`TaskPublish.tsx:210-225` `refreshPublished()` 先 `listTaskDates()` 再 `readTasksMany(全部日期)`，把**全部历史任务**读进内存、拍平成 `{date,task}[]`、倒序、全量 `.map()` 渲染；`:206-208` 与 `:227-230` 两个 effect 各发一次独立请求（无合并、无 loading 态、无 `cancelled` 守卫，快速切页后可能对已卸载组件 setState）。`openDetail`（`:304-313`）串行 `for await readTasks`。
- **影响**：切到「任务发布」页 = 一次全库读取 + 全量 DOM。数据量增长后这是**最大的卡顿点**，也让 `<main key={mode}>` 每次切回都重付一遍代价。
- **建议方案**：① 合并重复 effect 为一个（复用 P1-1 的索引能力）；② 「已发布任务」改为**分页 / 按时间窗加载**（默认最近 N 天 + 「加载更多」），或复用 `publish-history.json` 的 `records` 渲染（本来就有标题 / 日期 / 标签，不需要读全部天文件）；③ `openDetail` 改 `Promise.all` 并发；④ 补 `cancelled` 守卫。
- **工作量**：M
- **验证**：造 500+ 天数据，测量切页到可交互的时间；确认列表首屏只请求时间窗内数据。

### P1-3 `<main key={mode}>` 强制重挂载：丢草稿 + 重复全量请求

- **证据**：`App.tsx:294` `<main className="main" key={mode}>`。
- **影响**：**切换视图丢失全部未持久化状态** —— `TaskPublish` 待发布列表草稿、`DayView` 行内编辑草稿、`WeeklyView` 未 flush 的 800ms 防抖写入（`WeeklyView.tsx:128-134` 卸载时只清定时器、**不 flush**，即确认丢失）。同时每次切页都重跑该页的全量读取。
- **建议方案**：① 去掉 `key`，改为各视图自己处理重置；② 同时把关键草稿持久化（`TaskPublish` 的 `pending` 存 localStorage / 后端草稿文件）；③ `WeeklyView` 增加卸载时 flush（`useEffect` cleanup 里立即写入）。
- **依赖**：去掉 `key` 会立刻暴露「跨视图不同步」问题（[02](02-architecture.md) §4.2），需一并处理：把 `onTasksChanged` 从「只刷日历打点」改为**真正的数据变更通知**（引入轻量事件版本号，如 `dataVersion` 递增，各视图依赖它重拉）。
- **工作量**：M（含数据同步链路改造则 L）
- **验证**：在发布页填一半待发布内容 → 切到日报 → 切回，确认内容还在；在周总结输入后立即切页，确认不丢字。

### P1-4 所有列表无虚拟化

- **证据**：`TaskPublish` 已发布列表（`:365`）与发布历史（`:449`）、`TrashView`（`:62`）、`MeetingList` 卡片与时间轴（`:318,327`）、`StickyNotesView` 网格（`:187`）、`DayView` 任务列表（`:226`）全部 `.map()` 全量挂 DOM。
- **影响**：长列表首屏慢、滚动卡；`MeetingList` 还会在**每张卡片**上做 `stripHtml`（`createElement + innerHTML`，`:29-33,178,231,253`）。
- **建议方案**：① 优先做**窗口化 / 分页**而非引库（数据本身按时间分片，天然可分页）；② `stripHtml` 结果**预计算并缓存**在每个 meeting 对象上（`useMemo` 里一次算完），不要每渲染重算；③ 若确需虚拟列表，选轻量方案避免增加安装包体积（P1-5 约束）。
- **工作量**：M
- **验证**：造 500 条便签 / 200 场会议，测量打开耗时与滚动帧率。

### P1-5 安装包体积：把渲染层专用依赖移出 `dependencies`（约省 13MB）

- **证据**：实测 `dist/win-unpacked/resources/app.asar` = **19.69MB**，其中：
  | 包 | 大小 | 主进程是否真用到 |
  |---|---|---|
  | `highlight.js` | **5.16MB** | ❌（`lowlight` 的依赖，仅渲染层代码高亮） |
  | `@tiptap/*` + `prosemirror-*` 合计 | **≈7MB** | ❌（仅 `MeetingEditor.tsx`） |
  | `@mixmark-io/domino` + `turndown` | 1.72MB | ✅ `meetingExport.ts` |
  | `js-yaml` + `argparse` | 1.07MB | ✅ `updater.ts` |
  | `adm-zip` | 0.12MB | ✅ `backup.ts` |
  | `semver` | 0.07MB | ✅ `updater.ts` |
  | `out/` 产物 | 3.16MB | ✅ |
  - 已用 `grep` 确认主进程只 `import` 了 `adm-zip` / `turndown` / `turndown-plugin-gfm` / `js-yaml` / `semver`。
  - 渲染层由 Vite 完整打包进 `out/renderer`，**不依赖 asar 里的 node_modules**。
  - 同类优化已有先例：`lucide-react` / `@fontsource/*` 已被移入 `devDependencies`（提交 `3aa9445`），但 `@tiptap/*` / `lowlight` 漏了。
- **影响**：1.5.3 安装包 **98.99MB，Gitee 附件上限 100MB，余量仅 ~1MB** —— 已到「再加一个依赖就发不出去」的程度。此项可回收约 13MB（asar 19.69→约 6.5MB，maximum 压缩下安装包预计降到 ~90MB 级），是**性价比最高的一项优化**。
- **建议方案**：
  1. 把 `@tiptap/core`、`@tiptap/starter-kit`、`@tiptap/pm`、全部 `@tiptap/extension-*`、`lowlight` 从 `dependencies` 移到 `devDependencies`（渲染层仍能正常打包，因为 Vite 从 `node_modules` 解析，不看依赖分类）。
  2. ⚠️ **验证要点**：`externalizeDepsPlugin` 只外部化 `dependencies`，移走这些包后主进程产物不会尝试 `require` 它们（主进程本来就没引用），因此安全；但**必须重新 `npm run dist` 并实际启动安装后的应用**，逐个打开日报 / 会议 / 报表，确认无 `Cannot find module`。
  3. 顺手把 `electron-builder.yml` 的 `files` 加上 `!node_modules/**/{test,tests,__tests__,docs,example,examples,*.md}` 之类的排除项（可选，收益较小）。
  4. 中期建议：加一个 `npm run size` 脚本或 CI 检查，**超过 95MB 直接失败**，避免再次贴边。
- **额外收益**：`MeetingList` 静态 import `MeetingEditor`（`MeetingList.tsx:15`）导致点开「会议」即加载 1.35MB chunk。改为 `lazy(() => import('./MeetingEditor'))` 可让会议列表秒开 —— 与体积无关但同属「TipTap 太重」这条线。
- **工作量**：S
- **验证**：`npm run dist` 后确认安装包 < 95MB；`npx @electron/asar list` 确认 `@tiptap` / `highlight.js` 不再出现在 asar；安装并人工点检日报 / 周报 / 报表 / 会议 / 便签 / 回收站全流程。

### P1-6 其余 4 处 O(总天数) 全量扫描

- **证据**：
  | 位置 | 触发时机 |
  |---|---|
  | `tags.ts:30-43` `countTagUsage` / `:45-51` `listTags` | **每次打开标签页** |
  | `search.ts:24-65` `searchTasks` | 每次搜索（250ms 防抖后） |
  | `stats.ts:25-41` `rangeStats` | 统计页 / 报表（选一年 = 365 次读盘） |
  | `tasks.ts:283-303` `removeTagFromAllTasks` | 每次删除标签 |
  - 另有 `exporter.ts:81-108`、`:111-131`（周报 7 次、区间导出可达数百次）、`meetings.ts:60-77`（**每次保存会议都遍历解析全部会议文件**）、`sync.ts:18-47` `lastDataMtime`（`attachments/` 文件多时成百次 `stat`）。
- **影响**：标签页、搜索、统计是**高频入口**，每次都是全库 IO。
- **建议方案**：
  1. `countTagUsage` 与 `rangeStats` 可复用 P1-1 引入的索引 / 缓存层（按「天文件 mtime + 大小」做失效判断的内存缓存）；
  2. `searchTasks` 可复用同一缓存，并配合 P0-4 提前 `break`；
  3. `meetings.ts` 的 `saveMeeting` 改为**按 id 直接定位文件**（文件名即 id，只需 `fs.access` 检查旧命名），不必遍历目录；
  4. `lastDataMtime` 改为读取一个由写入方维护的 `R/.dirty` 时间戳文件，避免遍历。
- **工作量**：M（在 P1-1 的缓存层之上）
- **验证**：标签页 / 搜索 / 统计的耗时在 500+ 天数据下应显著下降；回归标签用量计数、统计口径、会议保存。

---

## P2 —— 可维护性

### P2-1 抽 `components/TagBadge.tsx`，消除约 14 份重复

- **证据**：标签徽章渲染逻辑完全一致（`tagById.get(id)` → `<span className="task-item-tag" style={{borderColor, color}}>`）。`TaskPublish.tsx` 内重复 **6 次**（`:384-397, 464-477, 537-550, 559-572, 600-613, 659-672`），另 `TaskDetail.tsx:79-87,113-126`、`WeeklyView.tsx:68-77,234-246`、`MeetingList.tsx:72-79,215-222` 各 2 份。
- **影响**：全项目最大的一处复制粘贴；改一次样式要动 5 个文件。
- **建议方案**：`<TagBadge tag={tag} />` + `<TagList ids={ids} tags={tags} />`，内联色收敛到组件内。同时把「`tags.find` 线性查找」改为传入 `Map`。
- **工作量**：S
- **验证**：`grep -c "task-item-tag"` 应从 ~14 降到 1–2；逐页目视标签颜色与边框无变化。

### P2-2 合并 `Modal` / `Drawer` 为一个 overlay 基元，并补齐可访问性

- **证据**：`Modal.tsx`（38 行）与 `Drawer.tsx`（37 行）几乎逐行重复，仅 class 与默认宽度不同。二者都缺 `role="dialog"` / `aria-modal` / `aria-labelledby` / **focus trap** / 打开时聚焦 / body 滚动锁（`Modal.tsx:25-36`、`Drawer.tsx:24-35`）；关闭按钮只有 `title` 没有 `aria-label`。
- **影响**：键盘与读屏用户无法可靠使用任何弹窗；Tab 会跑到底层页面。
- **建议方案**：单一 `Overlay` 组件（`variant: 'modal' | 'drawer'`）统一处理 Escape / 遮罩点击（保留 `onMouseDown + e.target === e.currentTarget` 的防拖选误关逻辑）/ focus trap / `aria-*` / portal。`Modal` 与 `Drawer` 保留为薄封装以免大范围改调用点。
- **工作量**：S–M
- **验证**：打开任一模态，Tab 循环停留在弹窗内、Esc 关闭、焦点回到触发按钮；`aria-dialog` 在 DevTools 中可见。

### P2-3 拆分 `TaskPublish.tsx`（699 行）

- **证据**：单文件含 `PendingTaskCard` + 主体 + 2 个抽屉（`:512-593`、`:595-684`）+ 1 个弹窗 + 6 份标签渲染，12 个本地状态。
- **建议方案**：拆为 `TaskPublish/` 目录：`index.tsx`（状态与编排）、`PendingTaskCard.tsx`、`PublishedList.tsx`、`PublishHistoryPanel.tsx`、`PublishedDetailDrawer.tsx`、`HistoryDetailDrawer.tsx`。顺带修 P1-2。
- **工作量**：M
- **验证**：发布 / 延期 / 详情 / 历史筛选全流程回归。

### P2-4 `index.ts` 瘦身（670 行）

- **证据**：全部 IPC 路由 + 业务编排挤在一个文件；`:299-330`（历史整批回收）与 `:218-235`（单任务回收）高度相似；`:450-471`、`:474-507`、`:624-639`、`:642-657` 四段「SaveDialog + writeFile + try/catch」几乎逐字重复；`migrate.ts:77`/`:122` 硬编码 `weekly/` 与 `publish-history.json` 路径绕过模块导出。
- **建议方案**：① 抽 `saveWithDialog(defaultName, filters, content)` 助手消除 4 段重复；② 把「回收站条目如何组装」下沉到 `trash.ts`（当前只存在于 IPC 层，无法复用与单测）；③ 按域拆 `src/main/ipc/{tasks,tags,weekly,settings,backup,...}.ts`，`index.ts` 只做注册；④ `migrate.ts` 改用 `weeklyPath()` / `historyPath()`。
- **工作量**：M–L
- **验证**：全部 IPC 功能回归（可用开发者工具逐个调用 `window.api.*`）。

### P2-5 `main.css` 25 个「轮次式」补丁分区收敛

- **证据**：37 个顶层分区中第 13–37 个以 `v3.1`…`v3.7` / `第三轮`…`第五轮` 命名且主题交叉（`v3.1：弹窗/抽屉`、`v3.1：发布页`、`v3.2：自定义日期选择器` 混在一起），后写覆盖先写。另有约 87 行硬编码色值。
- **建议方案**：按**组件域**重排分区（导航 / 日报 / 发布 / 周报 / 报表 / 会议 / 便签 / 弹窗基元 / 设置…），把轮次分区内容合并回对应域；**分批做、每批只移动不改变声明内容**，用目视对比防回归。同时清理硬编码色值 → 变量。
- **注意**：这是**纯高风险低收益**的重构，务必等 P0/P1 完成、且有稳定目视回归手段后再做。可先只做「加分区索引注释 + 修悬空变量」。
- **工作量**：L
- **验证**：浅色 / 深色 × 6 种强调色的逐页目视对比。
- **✅ 已做（2026-10-10）**：按本条自身的建议执行了**安全子集** —— ①**20 个轮次/版本号分区全部按领域改名**（`v3.1：弹窗/抽屉` → `弹窗 / 抽屉（Overlay 基元）` 等），并统一装饰符长度；②在文件顶部加了**分区索引注释**（含分区清单与样式约定）；③修掉悬空变量（见 P2-8）。**只改注释文字，未移动任何规则**，因此层叠覆盖关系与视觉结果**完全不变**（零回归风险）。
- **⛔ 刻意未做**：**物理重排**（把轮次分区的规则搬进领域分区）与**硬编码色值替换**。原因：①移动规则会改变层叠覆盖顺序，本条自己的验证要求是「浅色/深色 × 6 强调色逐页目视对比」，而当前环境**没有视觉回归手段**；②色值替换经实测**不可机械化** —— 89 行硬编码色值中只有 32 处与变量同值，且其中 23 处是 `color:#fff`（强调色按钮上的白字），改成 `var(--panel)` 在深色下会变成不可见；`#10b981` 等还可能是强调色预设本身。**这两项应在有截图对比能力时再做**，收益是纯整洁性，不动不影响功能。

### P2-6 抽取重复的 JSON 读写与日期实现

- **证据**：
  - `readJson` / `writeJson` 私有副本至少 3 处（`meta.ts:27-39`、`stickyNotes.ts:11-23`），另有各模块自写的 read/write 对（`trash.ts:19-22`、`history.ts:23-26`、`weekly.ts:31-43`、`tags.ts:24-27`、`tasks.ts:39-47`），`JSON.stringify(..., null, 2)` + `mkdir(recursive)` 样板重复约 8 次 —— 与 P0-2 是同一项工作，**合并做**。
  - 递归目录遍历三份实现：`backup.ts:13-29` `addDirToZip`、`storage.ts:34-43` `copyDirRecursive`、`backup.ts:44-57` `mergeDirs`。
  - **ISO 周两份实现**：`storage.ts:93-118`（主进程）与 `renderer/src/utils/date.ts`（渲染层），仅靠注释约定一致，**无测试保障**。
- **建议方案**：共享的 `jsonStore.ts`（P0-2）；日期工具下沉到 `src/shared/date.ts` 供两侧 import（渲染层由 Vite 打包，主进程直接引用，`shared/` 已在两个 tsconfig 的 include 中 —— 确认无 Electron API 依赖即可）。
- **工作量**：S（日期）/ 与 P0-2 合并（JSON）
- **验证**：`typecheck` 通过；跨年周边界（12-29 ~ 1-4）与 W53 年份的周报键在两侧一致（建议顺手补一个纯函数测试）。

### P2-7 删除死代码

- **证据**：
  | 项 | 位置 |
  |---|---|
  | `AboutModal.tsx`（133 行） | **全仓无 import**，功能被 `SettingsModal` 的 about tab 取代 |
  | `datesByGranularity` | `utils/date.ts:66-117`，无调用方 |
  | `TaskDetail` 的 `date` prop | `TaskDetail.tsx:19,32` 解构后从未使用，`DayView.tsx:330` 仍在传 |
  | `PostponeModal` 的 `onPostponed(added)` 参数 | 两个父级都写成无参箭头（`DayView.tsx:350`、`TaskPublish.tsx:691`） |
- **工作量**：XS
- **验证**：`npm run build` 通过；确认 about tab 功能未受影响。

### P2-8 修悬空 CSS 变量引用

- **证据**：`--fg` 在 `main.css:3539` 使用但**从未定义**；`App.tsx:295` 的 Suspense fallback 用了不存在的 `--text-secondary`（应为 `--muted`）。
- **影响**：这两处颜色在当前浏览器里回退为继承值/默认值，深色模式下可能对比度不足。
- **工作量**：XS
- **验证**：深色模式下检查对应元素颜色正常。

---

## P3 —— 安全、健壮性与体验

### P3-1 Markdown 渲染加 sanitize

- **证据**：`utils/markdown.ts:4` `new MarkdownIt({ html: true, linkify: true, breaks: true })`，**允许内嵌 HTML 且无 sanitize**；`RichView.tsx:51` 用 `dangerouslySetInnerHTML` 注入；`MeetingEditor` 保存原始 TipTap HTML；`MeetingList.tsx:105-109` 的 `MeetingDetail` **绕过 `RichView`** 直接注入。
- **风险等级**：中。渲染层 `contextIsolation: true` 且无 `nodeIntegration`，注入脚本**不能直接操作文件系统**，但可读写全部业务数据、调用全部 `window.api`（包括 `attach:*`、`backup:*`、`sync:*`）。触发面是本机私有数据，但**任务 / 会议正文可能来自 WebDAV 同步的他人备份**。
- **建议方案**：引入 DOMPurify（注意 P1-5 的体积约束，DOMPurify 约 45KB 且属渲染层、会进 bundle 而非 asar，影响可接受），在 `renderMarkdown` 出口统一 sanitize，保留 `wlattach://` 与 KaTeX 所需属性；同时让 `MeetingDetail` **改用 `RichView`**（顺带消除附件拦截逻辑的重复实现）。
- **工作量**：S
- **验证**：构造含 `<img src=x onerror=alert(1)>` 与 `<script>` 的正文，确认不执行且内容仍正常显示；确认 KaTeX 公式与附件链接仍可用。

### P3-2 附件写入路径校验

- **证据**：`attachments.ts:31-36` / `:45-50` 的 `folder` 参数**从未校验**，直接 `path.join(R,'attachments', folder)`；而**读取**侧 `attachmentUrlToPath` 有 `path.resolve` 前缀校验 → **读写不对称**，渲染层传 `../../` 可写到 R 之外。`sanitizeName` 也未处理 Windows 保留设备名（`CON`/`NUL`）。
- **建议方案**：在 `saveAttachmentBuffer` / `importAttachmentFile` 内对 `folder` 做白名单或 `path.resolve` 前缀校验（与读取侧对称）；`sanitizeName` 增加保留名与超长名处理。
- **工作量**：XS
- **验证**：直接调用 `window.api.saveAttachmentImage('../../evil', 'a.png', buf)`，确认被拒绝。

### P3-3 统一包管理器 / 清理锁文件

- **证据**：`pnpm-lock.yaml` 是**未跟踪文件**，与已跟踪的 `package-lock.json` 并存；README 与 `.npmrc` 均声明使用 **npm**。
- **影响**：两套锁文件会漂移；若误用 pnpm 安装，`node_modules` 结构与 electron-builder 的依赖收集可能不一致。
- **建议方案**：确认团队只用 npm，删除 `pnpm-lock.yaml`，并在 `.gitignore` 或 `package.json` 的 `packageManager` 字段中固定。
- **工作量**：XS

### P3-4 WebDAV 定时器可重配置 + 拉取冲突保护

- **证据**：`index.ts:593-606` `scheduleAutoSync` 只在启动时执行一次，`setInterval` 闭包捕获旧 settings → **改 `autoMode` / `intervalMinutes` 后必须重启应用**；`index.ts:610-621` `before-quit` 内 `await readSettings` 后才 `e.preventDefault()`，异步间隙另有 `before-quit` 监听器置位 `isQuitting`，且 `exitPushed` 一次性标志使第二次退出不再上传 → **退出上传存在丢同步窗口**；`webdavPull` 是合并覆盖，**无远端备份、无版本比较**，可能静默覆盖本地较新文件。
- **建议方案**：① `settings:set` 中若 WebDAV 相关字段变化则重建定时器（保存 `timer` 句柄先 `clearInterval`）；② `before-quit` 改为同步置位 `preventDefault` 再异步上传；③ 拉取前把本地导出到 `R/../pre-pull-backup/<时间戳>.zip`（复用 `exportBackup`）。
- **工作量**：M
- **验证**：改同步间隔后不重启，观察是否按新间隔执行；断开网络测试退出上传的失败路径不会卡死退出。

### P3-5 `SearchBox` 请求乱序保护

- **证据**：`SearchBox.tsx:30-34` 250ms 防抖后 `await searchTasks(q)` 直接 `setHits`，无请求序号 / AbortController。
- **影响**：快速输入时旧请求后到会覆盖新结果。
- **建议方案**：请求序号（`const seq = ++reqSeq.current` 后再比对）或 `AbortController`。
- **工作量**：XS

### P3-6 更新下载无超时 / 无取消

- **证据**：`updater.ts` `streamDownload` 有正确的背压（`drain`）与增量 sha512，但 `net.fetch` **无 AbortSignal**，无超时；网络卡住会一直挂起且 UI 无取消入口。
- **建议方案**：加超时与取消（`AbortController`），通过 `update:event` 增加 `cancelled` 状态；UI 的 `UpdateBubble` 加取消按钮。
- **工作量**：S

### P3-7 托盘提醒轮询改事件驱动

- **证据**：`tray.ts:108-121` `setInterval` **每 30 秒**读一次 `settings.json`（磁盘 IO，长期运行持续）；`lastFired` 是模块级变量，无停止 / 重配置句柄。
- **建议方案**：`settings:set` 时把 reminder 配置推给 tray 模块并重排定时器（用 `setTimeout` 精确定位到目标时刻，而非 30 秒采样）；返回 dispose 句柄。
- **附加收益**：修复「`HH:MM` 过后才开启设置则当天不提醒」的采样盲区。
- **工作量**：S

### P3-8 统计口径统一

- **证据**：`stats.ts:36-40` 只统计任务级标签、**忽略子任务标签**，而 `tags.ts:36-39` 的 `useCount` **统计子任务标签** → 同一「标签用量」概念两处口径不一致；`stats.ts` 的 `totalTasks += taskCount` 会把区间共享任务的**每天副本重复计数**（一周发布算 7 次）。
- **建议方案**：统一口径（建议两处都含子任务），并明确「区间共享任务按 1 个算还是按天算」—— 若要按 1 个算，需按 `task.id` 去重。
- **工作量**：S
- **验证**：造一个跨 7 天的区间任务 + 一个带标签的子任务，核对统计页与标签页数字。

### P3-9 可访问性铺开

- **证据**：导航项无 `aria-current`（`App.tsx:272-280`）；数十处图标按钮只靠 `title`（`DayView.tsx:213`、`TaskDetail.tsx:59,64,69,146`、`TagManager.tsx:199-207` 等）；`SearchBox` 无 label / role / 键盘选择；`DropdownSelect` 有完整 ARIA 但**无 ↑↓/Enter 导航**；tab 与视图切换无 `role="tab"` / `aria-pressed`（`MeetingList.tsx:299-304`、`TaskPublish.tsx:346-357`）。
- **正面样本**：`SettingsModal.tsx:208-209` 的色块带 `aria-label`；`DropdownSelect.tsx:56-69` 的 `role="listbox"` 齐全 —— 说明规范存在但未铺开，**照抄这两个样本即可**。
- **工作量**：M（机械性工作，可分批）

### P3-10 订阅系统主题变化

- **证据**：`App.tsx:154-159` 的 effect 在 `settings.theme === 'system'` 时只读一次 `matchMedia('(prefers-color-scheme: dark)')`，**未订阅 change 事件**。
- **影响**：系统切换深色时应用不跟随，需重启或改设置。
- **工作量**：XS

### P3-11 回收站 / 发布历史上限与归档

- **证据**：`trash.json` / `publish-history.json` 用 `unshift` + 全量重写，**无容量上限、无自动清理**，每次操作解析/序列化整个文件（`trash.ts:29-33`、`history.ts:29-33`）。
- **建议方案**：回收站加保留期（如 90 天）与条数上限；发布历史按年分文件。同时 `takeTrashItem` 的「取出即移除」应改为「先重放成功再移除」，避免恢复失败即永久丢失。
- **工作量**：S

### P3-12 备份导入的 zip 路径校验

- **证据**：`backup.ts:32-42` `importBackup` 解压后合并，未校验 zip 内条目路径（依赖 adm-zip 对含 `..` 条目的行为）。
- **建议方案**：解压前遍历条目，拒绝绝对路径与含 `..` 的条目。
- **工作量**：XS

---

## P4 —— IPC 契约与静默失败（2026-10-10 全量审计发现）

> 由子代理对 **59 个 IPC 通道**逐个比对「主进程实际返回形状 ↔ preload 声明类型 ↔ 渲染层用法」得出。
> 结论：57 个一致、1 个高危、1 个低危、0 个无法静态判定。高危项**已修**（见「已完成」）。

### P4-1 `sticky:add` 缺数组守卫（低概率、静默失败）

`src/main/stickyNotes.ts:31` 先 `readJson<StickyNote[]>(...)` 再直接 `all.push(note)` ——
全项目**唯一**没做 `Array.isArray` 守卫的读改写（同文件 `:23`/`:54`/`:72` 都有）。
`readJson` 对「合法 JSON 但类型不对」（例如手改成 `{}`）不校验、原样返回 →
`all.push is not a function` → invoke reject，而 `StickyNotesView.tsx:54` 的 `await` **无 catch**
→ 便签加不上且无任何提示。触发需要文件被外部改成合法非数组 JSON，概率低，但后果是静默失败。

### P4-2 `trash:restore` 假定条目含 `tasks` 数组（半损坏即失效）

`src/main/index.ts:373-375` 直接 `item.tasks.map(...)`，而 `readTrash`（`trash.ts:20-21`）
只校验顶层 `data.items` 是数组、**不校验每个条目**。半损坏/手改的 `trash.json` 会让 invoke reject，
`TrashView.tsx:25` 同样无 catch → 用户点「恢复」没反应。

### P4-3 `settings:set` 失败静默

写盘抛错时 handler reject，而 `src/renderer/src/App.tsx:257` 的
`window.api.setSettings(next)` 是**浮动 Promise 且无 `.catch()`** → 设置改了却不落盘、无提示。
（`writeJson` 失败会发 `data:warning`，但锁/IO 异常路径仍静默。）

### P4-4 渲染层普遍缺少 IPC 失败的 `.catch()`

P4-1/2/3 的共同放大器：渲染层多处 `await window.api.xxx()` 不带 catch，
一旦主进程 reject 就是「点了没反应」。建议统一约定：**所有会写数据的 IPC 都要有失败反馈**。

## 日志模块（进行中）后续任务

| 步骤 | 内容 | 状态 |
|---|---|---|
| Phase 1a | 数据层 + IPC 三处 + 26 项测试 | ✅ 完成（`e1b86c8`） |
| Phase 1b | 抽出共享富文本编辑器 `RichTextEditor`（会议与日志共用，**保持懒加载**） | 待做 |
| Phase 1c | `JournalView` 页面（默认按天 + 可切换连续时间线）+ 条目卡片 + 行内编辑 | 待做 |
| Phase 1d | 挂载任务选择器（当天任务多选 → 一行快照 → 点击跳转 → 失效降级） | 待做 |
| Phase 1e | 整合点：全局搜索纳入日志 ✅、回收站支持日志条目 ✅、**日历日志打点 ⏳ 未做** | ✅ 基本完成（`18d38d7`） |
| Phase 1f | 「任务正文改富文本」时 1.5.4 markdown → HTML 的无损迁移方案 | ✅ **方案已设计**（见下） |

### Phase 1f 设计：任务正文从 markdown 迁到富文本（**尚未实施**）

用户硬约束是「未来任务正文改为富文本时，可从 1.5.4 的 markdown **无损**迁移」。
方案的核心是**加字段、不动老字段**，从而天然满足向后兼容：

```ts
export interface Task {
  body: string          // markdown —— 现有字段，**永不删除、永不改写**
  bodyHtml?: string     // 新增：富文本 HTML（TipTap 产出）
  // …其余字段不变
}
```

**规则**

1. **渲染优先级**：有 `bodyHtml` 就用它（经 `sanitizeHtml`），否则用 `body` 走 markdown 渲染。
2. **懒迁移、不搞大搬迁**：只在用户**第一次用富文本编辑器打开并保存**某任务时，
   才把 `body`（markdown）用 markdown-it 转成 HTML 写入 `bodyHtml`。**不做批量迁移**，
   因此不存在「一次性重写全库」的风险窗口。
3. **`body` 永远保留** —— 这就是「无损」的来源：原始 markdown 是唯一真源，
   `bodyHtml` 只是派生的渲染缓存。任何时刻删掉 `bodyHtml` 都能回到原状。
4. **1.5.4 完全不受影响**：它只读 `body`（markdown），`bodyHtml` 是它不认识的额外字段，
   会被原样保留在文件里（`readTasks` 只挑选已知字段，但**写回时**必须小心 —— 见下）。
5. ✅ **未知字段会被保留 —— 已实测确认**（这是本方案成立的前提）。
   `readTasks`（`tasks.ts:43`）用 `{ ...t, … }` **展开原对象**，只补默认值；
   `updateTask`（`tasks.ts:103-141`）在展开得到的对象上原地改字段，写回时又是
   `tasks[idx] = { ...task, order }`。因此 1.5.4 **不会抹掉它不认识的 `bodyHtml`**，
   新旧版本可以安全地交替读写同一份数据。
   （**已用测试钉死**：`test:data` 第 14 节「未知字段在读写与更新后仍被保留」——
   写入含 `bodyHtml` 的天文件后，`readTasks` 读得到、`updateTask` 回写后文件里仍在，
   同时 `body`(markdown) 未被改动。将来若有人把 `readTasks` 改成逐字段构造新对象，这条测试会失败。）
6. **导出**（Word/PDF/Excel）优先用 `bodyHtml`，回退 `body`。
7. **搜索**：当前 `searchTasks` 对 `body` 做 `replace(/<[^>]+>/g,' ')` 去标签，
   两种格式都能检索；切富文本后无需改动。

**工作量**：`M`。**前置依赖已解除**（第 5 点已实测：未知字段被保留）。

## 建议的执行顺序

| 迭代 | 内容 | 理由 |
|---|---|---|
| **迭代 1** | P0-1（`status` 定案并落地）→ P0-2 + P0-3 + P2-6（JSON 层加固，合并做） | 先把「数据会丢 / 报错看不见」这两个最伤用户的问题解决；JSON 层抽一次覆盖 P0-2、P0-3、P2-6 三项 |
| **迭代 2** | P1-5（体积，S 级、收益最大）→ P0-4 → P2-7 → P2-8 → P3-3 | 一批低风险高收益的小改动，同时为体积腾出余量 |
| **迭代 3** | P1-1（索引/缓存层）→ P1-6（复用该层）→ P1-2 | 先建缓存与索引基础设施，再让高频入口与发布页受益 |
| **迭代 4** | P1-3（含数据变更通知链路）→ P1-4 | 需要先有第 3 迭代的缓存/通知能力 |
| **迭代 5** | P2-1（TagBadge）→ P2-2（Overlay）→ P2-3（拆 TaskPublish）→ P2-4（index.ts 瘦身） | 结构性重构，放在功能与性能稳定之后 |
| **迭代 6** | P3 全部 + P2-5（CSS 收敛，最后做） | 安全与体验收尾；CSS 重排风险高收益低，放最后 |

## 已完成

### 2026-10-10 优化批次（未发版）

| 项 | 实际做法 | 实测结果 |
|---|---|---|
| **P0-1** `status` 链路失效 | 新增 `components/Toast.tsx`（`useToasts` hook + 右下角气泡栈）；`shared/types.ts` 定义 `StatusReporter = (msg, level?) => void`；12 个组件的 `onStatus` prop 统一为该类型；错误类调用点补 `'error'`（停留 6.5s、描边标红）；Toast 去重 + 同屏上限 4 条 | 原先静默丢弃的 30+ 条反馈全部可见 |
| **P0-2** 写盘无原子性 + 读失败静默当空 | 新增 `src/main/jsonStore.ts`：`writeJson` 走「临时文件 + rename」；`readJson` 区分 ENOENT 与解析失败，**损坏文件改名隔离为 `<file>.corrupt-<时间戳>`** 后返回空值并告警；告警经新增 IPC 通道 `data:warning` 推到渲染层（启动期先缓冲，`did-finish-load` 后补发）；全部模块改用该层 | `npm run test:data` 验证：损坏文件被隔离、内容保留、后续写入不覆盖 |
| **P0-3** 并发写竞态 | `jsonStore.withDataLock` —— 全局串行写锁（单用户桌面程序，避免按键分锁的死锁复杂度）；**铁律：锁不可重入**，组合函数（如 `deleteTag`）必须让各步骤各自加锁；`App.tsx` 的 IPC 副作用移出 `setState` updater | `npm run test:data` 验证：20 个并发发布全部落盘，无丢更新 |
| **P0-4** `search.ts` 裁剪空操作 | 命中满 50 条即 `break outer`；改为**从最新日期往前**遍历，天然倒序，去掉 `reverse + slice` | 不再扫完全库 |
| **P1-1** `datesOfTask` 全库扫描 | 新增 `src/main/taskCache.ts`：①天文件按 `mtimeMs + size` 缓存解析结果；②`Map<taskId, Set<date>>` 索引，由发布/延期/删除/恢复**增量维护**；③索引查不到时回退全库扫描并回填（正确性不依赖索引完整）；④导入备份 / WebDAV 拉取后 `resetTaskCache()` | `npm run test:data` 验证索引在各写路径后仍正确 |
| **P1-5** 安装包体积 | `@tiptap/*`、`lowlight` 从 `dependencies` 移到 `devDependencies`（主进程只 require `adm-zip`/`js-yaml`/`semver`/`turndown`/`turndown-plugin-gfm`，已用 esbuild 产物 grep 验证）；`MeetingList` 改为 `lazy` 引入 `MeetingEditor`；新增 `npm run size`（`scripts/check-size.cjs`，含 asar 构成分析与"渲染层专用依赖泄漏"检测） | **asar 19.69 → 6.21 MiB**；`MeetingList` chunk **1,346 → 16.6 kB**（TipTap 移入独立的 1,330 kB `MeetingEditor` chunk）；安装包 98.99 → **97.20 MB**（十进制，−1.79 MB）。⚠️ 注意：asar 少 13.5 MiB，但安装包只少 1.79 MB —— NSIS maximum 压缩对 JS 文本约 8:1，**体积主要由 Electron 运行时决定**，不要再期待靠删依赖大幅瘦身 |
| **P1-6** 其余 O(总天数) 扫描 | 全部经 `readTasks` → 天文件缓存受益（`listTags`/`useCount`、`searchTasks`、`rangeStats`、`removeTagFromAllTasks`）；`meetings.ts` 的 `saveMeeting` 只在规范文件不存在时才扫描目录（原本每次保存都遍历解析全部会议），`deleteMeeting` 常见路径改为单次 unlink | — |
| **P1-2** TaskPublish 无界全量读取 | 已发布列表改为**时间窗加载**（默认最近 60 天，`加载更多` 每次再往前 60 天），不再 `readTasksMany(listTaskDates())` 全量拉取；补上卸载后的 `cancelled` 守卫；顶部提示"仅显示最近 N 天（共 M 天有任务）" | 读取量与 DOM 都随窗口有界 |
| **P1-3** 草稿丢失与数据新鲜度 | ①主区**去掉 `key={mode}`**；②新增 `dataVersion` 版本号：任何写操作后自增，`DayView`/`WeeklyView`/`TaskPublish`/`StatsView`/`TrashView`/`StickyNotesView` 把它放进取数 effect 依赖 —— 不重挂载也能刷新自身数据；③`TaskPublish` 的待发布草稿持久化到 localStorage（`wl-publish-draft`，含字段类型兜底；全部发布成功才清空）；④`WeeklyView` 周总结在**切周/卸载时 flush** 未落盘的 800ms 防抖内容，并把周总结的载入从 `dataVersion` 依赖中拆出（否则会覆盖用户正在输入的草稿） | ⚠️ **重要更正**：`key={mode}` **并不是**草稿丢失的真正原因 —— 各视图是条件渲染（`{mode === 'x' && <X/>}`），切换页签本来就会卸载。真正的修复是③④的持久化与 flush。去掉 `key` 本身近乎中性，保留删除只是因为它已无必要 |
| **P1-4** 列表分页/虚拟化 | `MeetingList` 改为**分页渲染**（每页 60 条 + `加载更多`，筛选条件变化回到第一页）；时间轴视图只对当前页分组；**`stripHtml` 结果按会议 id 缓存**（原本每次渲染每张卡片、每次击键都 `createElement + innerHTML` 重算整篇正文）。`TaskPublish` 由 P1-2 完成窗口化；`TrashView`（500 条上限）、`StickyNotesView`、`DayView`（单日）本身有界，不引入虚拟化以省下安装包体积 | — |
| **P2-1** 标签徽章 14 份重复 | 新增 `components/TagBadge.tsx`（`TagBadge` + `TagBadgeList`）。`TagBadgeList` 收 `Map<string, Tag>` 而不是数组 —— 旧实现在每处都做 `tags.find(...)` 线性查找；`TaskDetail`/`SubtaskEditor` 因此新增 `useMemo` 构建的 `tagMap`。全部 **14 处**替换完成（`TaskPublish` 6、`TaskDetail` 2、`WeeklyView` 2、`MeetingList` 2、`DayView` 1、`SubtaskEditor` 1） | `grep task-item-tag` 除 `TagBadge.tsx` 自身外**已归零** |
| **P2-2** Modal/Drawer 重复且缺可访问性 | 新增 `components/Overlay.tsx` 作为共同基元，实现：`role="dialog"` / `aria-modal` / `aria-labelledby`（每个实例独立 id）、**焦点陷阱**（Tab/Shift+Tab 在面板内循环、焦点在面板外时拉回）、**打开时初始聚焦**、**关闭时归还焦点**、**背景滚动锁**、Escape 与遮罩点击（保留防拖选误关的 `onMouseDown + target === currentTarget`）、关闭按钮 `aria-label`。`Modal`/`Drawer` 退化为薄封装（沿用原 class 名，CSS 无需改动） | 新增**浮层栈**：多层弹窗同时打开时，Escape/Tab 只由最上层响应（否则一次按键会关掉多层） |
| **P2-3** 拆分 `TaskPublish.tsx` | 改为 `components/TaskPublish/` 目录：`TaskPublishView.tsx`（主组件 + 两个抽屉，443 行）、`PendingTaskCard.tsx`（106 行）、`PublishedList.tsx`（97 行）、`types.ts`（100 行：`PendingTask`、草稿读写、粒度过滤等纯逻辑）。`App.tsx` 的懒加载导入指向 `TaskPublishView`，chunk 名从含糊的 `index-*.js` 变为清晰的 `TaskPublishView-*.js` | 主文件 676 → 443 行 |
| **P2-4** `index.ts` 瘦身 | ①抽出 `saveWithDialog(title, defaultPath, filters, save)`，消除 **5 处**逐字重复的「SaveDialog + writeFile + try/catch」（`meetings:export`/`export:md`/`backup:export`/`report:exportMd`/`report:exportWord`）；②把「回收站条目如何组装」从 IPC 层下沉到 `trash.ts` 的 `snapshotTaskToTrash` / `snapshotPublishRecordToTrash`（原先只存在于 IPC 层、无法复用也无法单测） | `index.ts` 795 → **650 行**；`trash.ts` 73 → 125 行 |
| **P0-5**（新增，功能性缺陷）图片永远无法显示 | 根因：`attach:saveImage` 返回对象 `{url,file}`，preload 声明 `Promise<string>`（`invoke` 返回 `any`，类型不被校验），渲染层 `![](${url})` / `<img src="${url}">` 插进去变成字面量 `[object Object]` → 任务正文与会议纪要的图片**长期显示为破图 + 文件名**。修复：主进程只返回 url 字符串；新增 `src/shared/attachmentUrl.ts` 的 `normalizeAttachmentUrl` 作为第二道防线并在 preload 接入；`test:data` 增加 11 项附件链路断言（含"对象直接插值会产生 [object Object]"这条回归断言） | 测试 54 → **65** 项全通过 |
| **P4（新增批次）** IPC 契约审计 | 子代理对全部 **59 个通道**逐个比对主进程返回形状 / preload 声明 / 渲染层用法。修复 2 处：**`meetings:delete`（高危）** 主进程返回 `undefined` 而声明 `{ok:boolean}`，渲染层首行读 `r.ok` → 异步回调抛 `TypeError` 且无人捕获，表现为「会议删了但抽屉不关、列表不刷新、无提示」；**`update:install`（低危）** 声明补 `message?: string` | 57 一致 / 1 高危（已修）/ 1 低危（已修）/ 0 无法判定 |
| **同步冲突检测失效**（顺带修复） | `sync.lastDataMtime` 原先只扫「根文件 + 一层子目录」，于是 `journal/<年>/<日期>.json`（三层）与 `attachments/meetings/<id>/x.png`（四层）的修改**完全不会被发现** → 本地明明改了却不提示冲突，可能静默覆盖对方数据。改为**递归**（深度上限 4） | — |
| **日志模块 Phase 1a**（新功能） | 数据层 `src/main/journal.ts`（一天一文件 `journal/<年>/<日期>.json`、原子写+写锁、条目清空删文件、**日期强校验阻断路径穿越**）+ 类型 + `paths.ts` + IPC 三处同步。同时给 `tasks.listDatesWithTasks` 补上「目录名必须是 4 位年份」的显式约束（原先靠 `journal/` 恰好多一层而侥幸不冲突） | `test:data` 65 → **91** 项 |
| **P2-5** CSS 分区收敛 | **安全子集已完成**：20 个轮次/版本号分区全部按领域改名 + 顶部加分区索引注释（含样式约定）+ 统一装饰符长度。**只改注释、未移动任何规则**，层叠与视觉结果完全不变。**物理重排与硬编码色值替换刻意未做**（需视觉回归手段；且色值替换实测不可机械化 —— 89 处中 23 处是强调色按钮上的 `color:#fff`，改动会在深色下变不可见） | 已无 `v3.x`/`第N轮` 分区名 |
| **P2-6**（路径与 JSON 样板） | 新增 `src/main/paths.ts` 作为**路径唯一真源**（原先散落 8 处、`migrate.ts` 还硬编码字面量）；各模块 `import + re-export` 保持既有调用方不变；`meta`/`trash`/`weekly`/`history`/`stickyNotes` 的私有 `readJson`/`writeJson` 副本全部删除（与 P0-2 合并完成） | — |
| **P2-6**（余项）日期工具去重 | 新增 `src/shared/date.ts` 作为**唯一实现**（`toDateStr`/`weekdayName`/`getWeekInfo`/`weekKeyToDates`/`enumerateDates`）；`src/main/storage.ts` 与 `src/renderer/src/utils/date.ts` 都改为 re-export（渲染层保留 `weekdayOf`/`weekInfoOf` 旧名作为别名，避免改调用点）。⚠️ 它同时新增了**12 项日期断言**（W01 跨年边界、2020-W53、`weekKeyToDates ↔ getWeekInfo` 往返、非法 key、跨月枚举） | 消除两份可能漂移的实现 |
| **P3-1** Markdown sanitize | 新增 `src/renderer/src/utils/sanitize.ts`：**默认拒绝的允许列表**（标签 + 属性白名单），`on*` 事件属性一律删除、URL 校验协议（http/https/mailto/wlattach/#/相对路径/内联图片）、`style` 过滤 `url()`/`expression()`/`position:fixed` 等；未知标签**拆壳保子**（不误删正文），`script`/`style`/`iframe`/`svg` 等**整棵删除**。接入 `renderMarkdown` 出口；`RichView` 新增 `kind="html"` 模式，`MeetingDetail` 改为使用它（不再自己 `dangerouslySetInnerHTML`）。**刻意不引 DOMPurify**：安装包只剩约 2.8MB 余量 | 新增 **14 项净化断言**（含 script 子树删除、`javascript:`、换行混淆、`url()` 注入、`position:fixed`，以及保留 `style` 颜色/`data-math`/https 外链/表格/wlattach） |
| **P3-9** 可访问性铺开 | ①`DropdownSelect` 补 **键盘导航**（↑↓/Home/End/Enter/Space/Esc + 焦点回到按钮 + `kb-active` 高亮）—— 原先只有 ARIA 属性却完全无法用键盘选择；②`App.tsx` 导航项加 `aria-current="page"`；③`TaskPublish` 页签加 `role="tablist"`/`role="tab"`/`aria-selected`；④`TagManager` 色块加 `aria-label`/`aria-pressed`；⑤**用 codemod 给全部 66 个带 `title` 的按钮补上 `aria-label`**（`title` 不是可靠的可访问名） | `aria-label` 从个位数 → 72 处；仍缺标签的按钮 **0** |
| **P2-7** 死代码 | 删除 `AboutModal.tsx`（133 行）、`utils/date.ts` 的 `datesByGranularity`、`TaskDetail` 的 `date` prop、`PostponeModal.onPostponed(added)` 参数 | — |
| **P2-8** 悬空 CSS 变量 | `main.css` 的 `--fg` → `--text`；`App.tsx` 的 `--text-secondary` → `--muted` | — |
| **P3-2** 附件写入校验 | `sanitizeFolder()`：丢弃 `.`/`..`/空段、替换保留字符（消除写侧路径穿越，与读侧校验对称）；`sanitizeName()` 增加控制字符、Windows 保留设备名（`CON`/`NUL`/`COM1`…）、超长截断、结尾点空格处理；`attachmentsDir` 增加 `resolve + 前缀比较` 双保险；`meetingAttachmentsDir` 改走同一净化 | — |
| **P3-3** 锁文件 | 删除未跟踪的 `pnpm-lock.yaml`（项目声明只用 npm） | — |
| **P3-4** WebDAV 定时器与退出同步 | `applyAutoSync()` 统一管理定时器，`settings:set` 中仅当**排程相关字段变化**时重排（比较 `enabled/autoMode/intervalMinutes/url/username`）；`before-quit` 改为**同步**读内存缓存的 `cachedSettings` 判断 + `preventDefault` 后再异步上传（消除丢同步窗口）；拉取前自动导出本地快照到 `userData/pre-pull-backup`（保留 3 份，放在数据根之外避免被再次打包上传） | — |
| **P3-5** 搜索乱序 | `SearchBox` 增加请求序号（`reqSeq`），输入变化即作废在途请求；顺带补齐 `role="combobox"` / `aria-expanded` / `aria-activedescendant` / `role="listbox"` 与 ↑↓/Enter/Esc 键盘导航 | — |
| **P3-6** 更新下载无超时/取消 | `fetchWithTimeout`（建连 30s）；流式下载增加**无数据看门狗**（45s 无块即中止）；新增 `cancelUpdateDownload()` + IPC `update:cancel` + 气泡与设置页的「取消下载」按钮；用户取消走独立的 `cancelled` 事件（不当作错误） | — |
| **P3-7** 托盘轮询 | 去掉「每 30 秒读一次 settings.json」的轮询，改为**一次性 `setTimeout` 精确排到目标时刻**、触发后递归排下一天；`applyReminder(enabled, time)` 供设置变化时重排（未变化则不动已排好的定时器）；顺带修掉「HH:MM 过后才开启则当天不提醒」的采样盲区 | — |
| **P3-8** 统计口径 | `totalTasks`/`doneTasks`/`pendingTasks` **按 task id 去重**（区间共享任务不再按天重复计数）；`tagCounts` 改为**同时统计子任务标签**（与 `tags.ts` 的 `useCount` 对齐）；`daily[]` 仍为逐日出现次数；`StatsView` 加 title 说明 | — |
| **P3-10** 系统主题 | `App.tsx` 在 `theme === 'system'` 时订阅 `matchMedia('(prefers-color-scheme: dark)')` 的 `change` 事件 | — |
| **P3-11** 回收站 | 新增 500 条上限（安全阀，超出时保留最新并**通过告警通道告知用户**，不静默丢弃）；新增 `findTrashItem`，恢复流程改为「**先重放成功再移出回收站**」（原 `takeTrashItem` 取出即移除，重放失败即永久丢失，已删除该 API）；`restoreTasksToDays` 按 `date::id` 去重且跳过已存在的 id | — |
| **P3-12** 备份 zip 校验 | `assertSafeZipEntries()` 在解压前拒绝绝对路径与含 `..` 的条目（zip-slip） | — |
| 新增 | `scripts/test-datalayer.cjs` + `npm run test:data`：数据层集成测试（用 esbuild 打包 `tasks.ts` 在临时目录跑真实读写，18 项断言） | 18/18 通过 |

### 更早

| 项 | 完成于 |
|---|---|
| 移除「休息日」功能（含 IPC / 数据文件 / 日报勾选框 / 周报徽标 / CSS） | 1.5.4 开发中（未提交，见 [05](05-progress.md) §3.1） |
| 任务备注改为详情底部独立编辑 | 1.5.4 开发中（未提交，见 [05](05-progress.md) §3.2） |
| 渲染层依赖 `lucide-react` / `@fontsource/*` 移出 `dependencies`（体积） | 提交 `3aa9445`（1.5.1） |
| `turndown` / `turndown-plugin-gfm` 移入 `dependencies`（修打包后启动崩溃） | 提交 `561cdf3` / `3c7c134` |
| 渲染层懒加载 10 个视图（内存优化） | 1.5.1 |
| 非默认视图懒加载 + KaTeX 动态 import | 1.5.1 前后 |
| 恢复 GPU 硬件加速（修卡顿） | 1.5.2 |
