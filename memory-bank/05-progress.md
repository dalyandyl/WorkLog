# 05 开发进度与在制品（Progress）

> 更新规则：每完成一轮工作，**必须**更新本文件的「当前状态」与 [session-log.md](session-log.md)。

## 1. 当前状态快照

| 项 | 值 |
|---|---|
| `package.json` 版本 | **1.5.3**（已发布） |
| Git 分支 | `master` |
| 最近提交 | `c147397 v1.5.3: 新增便签与任务延期功能（发布 1.5.3）` |
| 工作树 | **有未提交改动（1.5.4 的在制品，见 §3）** |
| 类型检查 | ✅ `npm run typecheck` 通过（exit 0） |
| 构建 | ✅ `npm run build` 通过（exit 0，out/ 合计 3.15 MB） |
| 下一步 | 收尾在制品 → 进入**优化阶段**，清单见 [07-optimization-backlog.md](07-optimization-backlog.md) |

## 2. 版本历史

| 版本 | 日期 | 主要内容 |
|---|---|---|
| 1.5.3 | 2026-09-10 | 便签功能（置顶便签显示在日报）；任务「延期」（追加新区间，同 id 全区间同步）；便签页通栏卡片布局 |
| 1.5.2 | 2026-09-10 | 恢复 GPU 硬件加速，修按钮悬停 / 弹窗打开卡顿 |
| 1.5.1 | 2026-09-09 | 更新公告页；启动自动检测更新的右下角气泡；下拉统一；导航分组可收起；取消主区底部状态栏；勾框美化 |
| 1.5.0 | 2026-09-08 | 界面重构：左侧竖排导航（分组）、强调色 6 种、Lucide 图标 + Inter/JetBrains Mono、圆角与阴影分层、隐藏滚动条 |
| 1.4.3 | 2026-09-07 | 会议纪要功能（富文本 / 标签 / 附件 / 导出 MD）；附件可删除；修 dev 模式 protocol 初始化时机 |
| 1.4.2 | 2026-09-04 | 设置页「更新镜像源」选择（自动 / Gitee / GitHub） |
| 1.4.1 | 2026-09-04 | 设置显示日志目录；日历年月标题弹年月日选择器；更新先确认再下载；数据目录迁到 `%APPDATA%/WorkLog/logs` |
| 1.4.0-beta | — | 修顶部搜索下拉被裁剪；单实例启动 |
| 1.3 及更早 | — | 「项目结构层级」功能（已在 1.5.x 前整体取消）；回收站 / 同步 / 报表 / 富文本编辑器等基础能力 |

- 发布流程与注意事项见 [06-conventions.md](06-conventions.md) §4。
- 应用内「更新公告」数据在 `src/renderer/src/data/releaseNotes.ts`，**只保留了最近 3 个版本**（1.5.3 / 1.5.2 / 1.5.1），更早版本未在该数组中。

## 3. 在制品（work in progress，未提交）

> ⚠️ 这批改动**已在工作树中但尚未提交，也尚未提升版本号**。改动性质：两个小功能调整 + 一轮 UI 打磨。
> 已通过 `npm run typecheck` 与 `npm run build` 验证，但**未做运行时人工验证**（未启动应用点检）。

### 3.1 删除「休息日」功能（跨 9 个文件）

| 文件 | 改动 |
|---|---|
| `src/main/meta.ts` | 删除 `RestFile` 接口、`restPath()`、`readRestMap()`、`isRest()`、`setRest()`、`withRestLock` 串行锁（-47 行） |
| `src/main/index.ts` | 删除 `rest:get` / `rest:set` 两个 IPC handler 与 `isRest, setRest` import |
| `src/preload/index.ts` | 删除 `isRest` / `setRest` 转发与类型声明 |
| `src/preload/index.d.ts` | 删除 `WorkLogApi` 上的 `isRest` / `setRest` |
| `src/main/exporter.ts` | `daySection` / `buildDayMarkdown` / `buildWeekMarkdown` / `buildRangeMarkdown` 全部去掉 `restSet` 参数与「（休息日）」标题标记（-25/+18 行） |
| `src/renderer/src/components/DayView.tsx` | 删除 `isRest` state、`toggleRest()`、日期头部的「休息日」勾选框 |
| `src/renderer/src/components/WeeklyView.tsx` | 删除 `restSet` state、`DayBlock` 的 `isRest` prop 与 `.weekly-rest` 徽标 |
| `src/renderer/src/assets/main.css` | 删除 `.rest-toggle`（改名 `.toggle-row`）、`.weekly-rest`、`.cal-refresh-msg` 三个类 |
| `src/renderer/src/components/SettingsModal.tsx` | 提醒开关的类名 `rest-toggle` → `toggle-row` |

**验证结果**：全仓 grep `isRest|setRest|rest-toggle|readRestMap|rest\.json|休息日|restSet|weekly-rest` 已**无残留引用**（仅剩 `utils/holidays.ts` 的 `isRestDay` 与 `Calendar.tsx` 调用 —— 那是独立的法定节假日逻辑，与本次删除无关）。`logs/rest.json` 在本机**不存在**，无需数据迁移；旧版本残留的 `rest.json` 已无人读取，可安全删除。

### 3.2 任务备注改为「详情底部独立编辑」

**动机**：备注原先混在整任务行内编辑模式里（一进去要保存整篇），改动不便。

| 文件 | 改动 |
|---|---|
| `DayView.tsx` | 行内编辑态删除 `editNote`；新增 `updateNote(taskId, note)` → `updateTask(date, taskId, { note })` + 本地状态同步 + `onStatus('备注已保存（所有天同步）')`；向 `TaskDetail` 传 `onUpdateNote` |
| `TaskDetail.tsx` | 新增 `noteEditing` / `noteDraft` 本地态；备注区常驻显示，标题栏加铅笔按钮进入编辑，textarea + 💾 保存 / ✕ 取消按钮；无备注时显示「（无备注）」 |
| `main.css` | 新增 `.task-note-label`（inline-flex + gap）、`.note-edit-btn` 的透明度 hover、`.task-note-actions`、`.task-note-empty` |

**注意**：备注仍是 `Task` 上的共享字段，保存后**所有天同步**（这正是 [03](03-data-model.md) §4 的不变量 2）。

### 3.3 UI 打磨

| 文件 | 改动 |
|---|---|
| `main.css` | `.sidebar-heading`（侧栏「功能」父级标题）字号 11px→15px、`font-weight` 600→700、颜色 `--muted`→`--text`，与下方分组标题拉开层级 |
| `Calendar.tsx` | 「更新日历」按钮改为「图标 + 文字」形式，刷新中图标加 `.spin` 旋转动画；**删除 `refreshMsg` 状态与 `.cal-refresh-msg` 提示**；改为保证转圈**至少 800ms**（静态年份数据会瞬间返回，否则用户看不到反馈）；「回到今天」按钮加 `CalendarDays` 图标 |
| `main.css` | 新增 `@keyframes wl-spin` 与 `.cal-refresh-btn svg.spin`；`.cal-foot-btns .today-btn svg` 加 `flex: none` |

### 3.4 其它工作树状态

- `pnpm-lock.yaml` 是**未跟踪文件**。项目配置的包管理器是 **npm**（README 与 `.npmrc` 均如此），`package-lock.json` 已跟踪。这个 pnpm 锁文件属历史残留，与 `package-lock.json` 并存有版本漂移风险 → 见 [07](07-optimization-backlog.md) P3-3。

## 4. 在制品收尾清单

发布 1.5.4 前需要完成：

- [ ] **运行时人工点检**（本次仅在静态编译层验证）：日报备注编辑 / 保存 / 跨天同步；周报与报表导出中不再出现「休息日」字样；日历刷新按钮转圈与节假日标红正常；设置页提醒开关样式正常。
- [ ] `package.json` 版本号 → `1.5.4`。
- [ ] `CHANGELOG.md` 顶部新增 `## [1.5.4]` 章节（发布脚本据此生成 Release 备注）。
- [ ] `src/renderer/src/data/releaseNotes.ts` 数组最前面插入 1.5.4 条目（否则应用内「更新公告」看不到本版内容）。
- [ ] `README.md` 的「功能总览」与「目录结构」同步：**移除休息日相关描述**；确认「备注」的描述与新交互一致（现描述为「可改标题/标签/子任务/正文/备注」）。
      → **已于 2026-10-10 完成**：日报条目改为「行内编辑不含备注 + 详情底部备注独立编辑」；目录结构中 `meta.ts` 的注释由「休息日 + 应用设置」改为「应用设置」；并在 README 顶部新增「项目记忆库」小节。
- [ ] 检查旧数据兼容：老任务 `note` 字段仍在 `Task` 上，`readTasks` 有兜底，无需迁移。
- [ ] `npm run publish:gitee` + `npm run publish:github`，然后 `git tag -a v1.5.4 -m "..."`。

## 5. 优化阶段进展（2026-10-10，未发版）

> 已按 [07-optimization-backlog.md](07-optimization-backlog.md) 执行第一批优化。**未发版**（版本号仍是 1.5.3）。
> 逐项做法与实测数据见 [07](07-optimization-backlog.md) 文末的「已完成」表。

### 已完成

| 级别 | 项 | 一句话 |
|---|---|---|
| P0 | P0-1 | 修复 `status` 死链路 → 新增 Toast + `StatusReporter`，30+ 条用户反馈（含全部错误提示）重新可见 |
| P0 | P0-2 | `jsonStore`：原子写（临时文件 + rename）+ 损坏文件**改名隔离**而非静默当空 + `data:warning` 通道推到界面 |
| P0 | P0-3 | `withDataLock` 全局串行写锁，消除 read-modify-write 丢更新 |
| P0 | P0-4 | `search.ts` 命中满 50 即停、由新到旧遍历 |
| P1 | P1-1 | `taskCache`：天文件 mtime 缓存 + 「任务→日期」增量索引，替换 `datesOfTask` 的全库扫描 |
| P1 | P1-5 | 安装包 98.99 → 97.20 MB；asar 19.69 → 6.21 MiB；`MeetingList` chunk 1,346 → 16.6 kB；新增 `npm run size` 守卫 |
| P1 | P1-6 | 其余 4 处全库扫描经同一缓存受益；`saveMeeting`/`deleteMeeting` 不再每次遍历全部会议文件 |
| P1 | P1-2 | 「已发布任务」改为时间窗加载（默认 60 天 + 加载更多），不再全量拉取 |
| P1 | P1-3 | 去掉 `key={mode}` + 引入 `dataVersion` 驱动各视图自行刷新；待发布草稿持久化；周总结切页/卸载时 flush |
| P1 | P1-4 | `MeetingList` 分页渲染 + `stripHtml` 结果缓存 |
| P2 | P2-1 | 抽出 `TagBadge` / `TagBadgeList`，消除 6 个文件里 **14 处**重复的标签徽章渲染（并去掉每处的线性 `tags.find`） |
| P2 | P2-2 | 抽出 `Overlay` 作为 Modal/Drawer 共同基元：补 `role="dialog"`/`aria-modal`/`aria-labelledby`、**焦点陷阱**、初始聚焦、关闭归还焦点、背景滚动锁、浮层栈（多层弹窗只让最上层响应 Escape/Tab） |
| P2 | P2-3 | 拆分 `TaskPublish` 为目录（`TaskPublishView` 443 行 + `PendingTaskCard` + `PublishedList` + `types`） |
| P2 | P2-4 | `index.ts` 795→650 行：抽出 `saveWithDialog`（消除 5 处重复）、回收站组装下沉到 `trash.ts` |
| P2 | P2-6/7/8 | 路径唯一真源 `paths.ts`、JSON 样板收敛、**日期工具合并到 `src/shared/date.ts`**、死代码清理、悬空 CSS 变量修复 |
| P2 | P2-5 | **安全子集**：20 个「轮次式」CSS 分区按领域改名 + 顶部加分区索引注释（只改注释、不移动规则，零回归）；物理重排与硬编码色值替换刻意未做（需视觉回归手段） |
| P3 | P3-1 | Markdown/HTML **净化**（`utils/sanitize.ts`，默认拒绝允许列表）+ `MeetingDetail` 改用 `RichView kind="html"` |
| P3 | P3-9 | `DropdownSelect` 键盘导航、导航 `aria-current`、页签 `role="tab"`、色块 `aria-label`、**全部 66 个带 title 的按钮补 `aria-label`** |
| P3 | P3-2/3/4/5/6/7/8/10/11/12 | 附件路径校验、锁文件清理、WebDAV 定时器可重配置 + 退出同步修复 + 拉取前快照、搜索乱序保护、更新可取消与超时、托盘精确排程、统计口径统一、系统主题订阅、回收站安全阀 + 恢复不再丢数据、zip-slip 校验 |

### 新增的验证手段（重要）

```bash
npm run test:data    # 数据层 + 日期 + 净化 集成测试（54 项断言）—— 改 src/main 或 utils 后必跑
npm run size         # 安装包体积守卫（打包后跑，超 98MB 直接失败）
```

### 剩余待办

**P0–P3 的可执行项已全部完成。** 唯一未做的是 **P2-5 的物理重排与硬编码色值替换** ——
它需要「浅色/深色 × 6 强调色逐页目视对比」这一当前环境不具备的验证手段，且其安全子集已完成。
详见 [07](07-optimization-backlog.md) 的 P2-5 条目「⛔ 刻意未做」。

### 尚未验证的部分（发版前需人工点检）

- **未启动过应用**（本轮全部验证在 `typecheck` / `build` / `test:data` / `dist` 层面）。需人工确认：Toast 展示与自动消失、备注编辑、标签/便签/回收站全流程、会议编辑器按需加载、设置页同步与更新、深色与 6 种强调色下的新样式（Toast、`search-hit.active`、`editor-loading`、更新气泡取消按钮）。
- 安装包已构建但**未安装运行**（`dist/worklog-1.5.3-setup.exe`）。
- `data:warning` 通道在**打包版**下的端到端表现（启动期缓冲后补发）需实测。
