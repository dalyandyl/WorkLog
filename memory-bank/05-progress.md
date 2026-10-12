# 05 开发进度与在制品（Progress）

> 更新规则：每完成一轮工作，**必须**更新本文件的「当前状态」与 [session-log.md](session-log.md)。

## 1. 当前状态快照

| 项 | 值 |
|---|---|
| `package.json` 版本 | **1.5.4**（已发布，2026-10-10） |
| Git 分支 | `master` |
| 最近提交 | `17076a7 v1.5.4: 移除休息日与备注独立编辑 + P0–P3 系统性优化（数据安全/性能/可维护性/安全/可访问性）` |
| 工作树 | ✅ 干净（1.5.4 已提交并发布） |
| 类型检查 | ✅ `npm run typecheck` 通过（exit 0） |
| 构建 | ✅ `npm run build` 通过（exit 0） |
| 数据层测试 | ✅ `npm run test:data` **109/109** 通过 |
| 发布状态 | ✅ 两端均已发布：Gitee 完整（release + master + tag）；GitHub 发行版 + master + tag 均已就位。详见 §6 |
| 下一步 | **正在做「日报 → 日志 + 任务」拆分**：Phase 1a（日志数据层）已完成，界面待做，见 §7。可选：P2-5 物理重排（需视觉回归手段） |

## 2. 版本历史

| 版本 | 日期 | 主要内容 |
|---|---|---|
| 1.5.4 | 2026-10-10 | 移除「休息日」标记；任务备注改为详情底部独立编辑；**P0–P3 系统性优化**：数据安全加固（原子写 / 损坏隔离 / 写锁）、操作反馈气泡、性能与索引、可维护性重构、HTML 净化、可访问性 |
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
npm run test:data    # 数据层 + 日期 + 净化 + 附件 + 日志 + 搜索 + 兼容性 集成测试（109 项断言）—— 改 src/main 或 utils 后必跑
npm run size         # 安装包体积守卫（打包后跑，超 98MB 直接失败）
```

### 剩余待办

**P0–P3 的可执行项已全部完成。** 唯一未做的是 **P2-5 的物理重排与硬编码色值替换** ——
它需要「浅色/深色 × 6 强调色逐页目视对比」这一当前环境不具备的验证手段，且其安全子集已完成。
详见 [07](07-optimization-backlog.md) 的 P2-5 条目「⛔ 刻意未做」。

### 尚未验证的部分（发版前需人工点检）

- **未启动过应用**（全部验证在 `typecheck` / `build` / `test:data` / `dist` 层面）。需人工确认：Toast 展示与自动消失、备注编辑、标签/便签/回收站全流程、会议编辑器按需加载、设置页同步与更新、深色与 6 种强调色下的新样式（Toast、`search-hit.active`、`editor-loading`、更新气泡取消按钮）。
- 安装包已构建并发布，但**未在本机安装运行**。
- `data:warning` 通道在**打包版**下的端到端表现（启动期缓冲后补发）需实测。

## 6. 1.5.4 发布记录（2026-10-10）

### 产物

| 项 | 值 |
|---|---|
| 提交 | `17076a7`（含 1.5.4 功能调整 + P0–P3 优化，80 个文件、+6202/−1822 行） |
| 标签 | `v1.5.4`（附注标签） |
| 安装包 | `worklog-1.5.4-setup.exe`，97,210,032 字节 ≈ 92.71 MiB |
| `latest.yml` sha512 | `rYM4Ra0ImK7n6V/0NiNsnh/HBOUxGeas+ufWtNnEu+0JTEr4uqfaG7o93unVR/Xwb9JyqKVFWTRRWUNfBdK1EA==` |

### 两端发布结果

| 平台 | 发行版 | git 推送 | 完整性验证 |
|---|---|---|---|
| Gitee | ✅ v1.5.4（latest.yml + setup.exe） | ✅ master + tag 均指向 `17076a7` | ✅ 实测安装包 sha512 与 latest.yml 声明**完全一致** |
| GitHub | ✅ v1.5.4（latest.yml + setup.exe，asset 登记 size=97,209,993） | ✅ master=`a884a87`、tag=`17076a7`（tag 曾错位，已 `--force` 纠正） | ⚠️ 仅确认 size 自洽（97,209,993 = yml 声明值）；sha512 因下载通道不稳定未验证 |

**两端最终一致**：`master = a884a87`、`v1.5.4 = 17076a7`（Gitee 与 GitHub 完全相同）。

### ⚠️ 本机访问 GitHub 的正确姿势（重要）

本机通过 **Steam++ / Watt Toolkit 加速器**访问 GitHub：hosts 把全部 github 域名指向 `127.0.0.1`，
由 `Steam++.Accelerator`（监听 `0.0.0.0:443`）做本地反向代理；git 端已配置 `http.sslBackend = schannel`，
因此能信任加速器的证书。**加速器未启动时**`github.com` 与 `objects.githubusercontent.com` 均不可达
（`api.github.com` / `uploads.github.com` 即使无加速器也可达，所以发布附件能上传）。

实测结论：

- ✅ **`git push` / `ls-remote` 经加速器可用**（本次据此完成了 master 与 tag 推送）；
- ⚠️ **大文件下载经加速器不稳定** —— 93MB 安装包多次中断（`curl: (56) Recv failure: Connection was reset` /
  `end of response with ... bytes missing`）。因此**校验 GitHub 附件 sha512 需要换通道**（直连、或换加速器节点），
  或直接跳过（size 已自洽，且主源 Gitee 已逐字节验证）。
- 推论：应用内「GitHub 镜像源」在这台机器上下载更新**大概率会失败**；`updateSource: auto` 优先 Gitee，不影响正常更新。

### Gitee 附件配额（运维约束）

Gitee 仓库附件配额 **1 GB 累计**（不是单文件 100MB）。发布 1.5.4 前已用 966.3 MB / 11 个发行版，
**仅剩 57.7 MB，装不下 92.7 MB 的安装包**，首次上传直接失败（`文件大小已超出仓库附件配额：1 GB`）。
已按用户决定删除 3 个 beta 版（`v1.2.0-beta` / `v1.4.0-beta` / `v1.4.1-beta`）释放 296.9 MB，
现用 669.4 MB，剩余 **354.6 MB**（约够再发 3 个版本）。**后续每次发版前都要留意此配额。**

## 7. 日志模块（进行中）

**目标**：把「日报」拆成两个**相互独立**的模块 —— **日志**（个人手记）与**任务**（现有日报的演进）。
两者唯一联系：日志可**按需关联**当天任务（快照行 + 可跳转，任务删除后文字保留）。

**本期范围**（用户指定）：**只做日志模块 + 修图片显示缺陷**；任务侧不动、导出（Word/PDF/Excel）不做。

> ⚠️ **界面已按用户反馈重塑过一轮**（同日）：原实现是「一天多条 + 卡片 + 时间线/按天切换」，
> 用户明确要「左栏天列表 + 右栏一天一篇、像 Word 那样的写作体验」，因此
> **数据模型改为一天一篇**（含旧 `entries[]` 的兼容读法）并重做布局与样式。详见 [03](03-data-model.md) §9。

| 步骤 | 内容 | 状态 |
|---|---|---|
| Phase 0 | 图片永远无法显示的缺陷（IPC 返回对象 vs 声明 string） | ✅ 已修（`6011c09`） |
| Phase 1a | 日志数据层 + IPC 三处 + 测试 | ✅ 完成 |
| Phase 1b | 抽出共享 `RichTextEditor`（会议与日志共用，**保持懒加载**） | ✅ 完成（`034869b`） |
| Phase 1c/1d | 日志页面 + 关联任务 | ✅ 完成，**随后按反馈重塑为一天一篇 + 两张纸布局**（`9d2c942`） |
| Phase 1e | 全局搜索纳入日志 ✅、回收站支持日志 ✅ | ✅ 完成（`18d38d7`） |
| Phase 1e 余项 | **日历「有日志」打点** | ⏳ 待做 |
| Phase 1f | 「任务正文改富文本」的无损迁移方案 | ✅ 方案已设计 + 前置依赖已实测解除 |
| 编辑器缺陷 | 无效的 `caret-line-highlight`、编辑面缺 `outline:none`、无 `mark` 样式 | ✅ 已修（`f844940`） |
| **黄框** | 用户反馈的「编辑器内容区有黄框」 | ❌ **仍未确诊**（见下） |

**导航已按域重排**：「日志」组 = 日志；「任务」组 = **任务（原「日报」改名）** / 周报 / 任务发布；
分析与管理组不变。周报/报表基于任务汇总，因此归在「任务」组。

**构建产物（懒加载生效）**：`RichTextEditor` chunk 1,328 kB（**会议与日志共享**，仅打开其一时才加载）、
`MeetingEditor` 3.28 kB、`JournalView` 15.3 kB、主包 877 kB（**不含 TipTap**）。

### ⚠️ 黄框：**画面级证据已排除本应用**（但成因仍未在用户机器上确认）

**两轮排查，全部有实测证据：**

**第 1 轮 —— CSS / 计算样式（Electron 探针）**

| 检查 | 结果 |
|---|---|
| `CSS.supports('caret-line-highlight','none')` | **false** → 项目原有那条「关闭黄框」的 CSS 是**彻底的空操作** |
| 编辑态 `.ProseMirror` 的 outline / border / box-shadow | **无任何黄色** |
| `main.css` 里带黄色系色值的规则 | **0 条** |
| 用户 Windows 强调色 / App 强调色 / 数据里的 `<mark>` | `#0078D4`（蓝）/ violet / 无 |

**第 2 轮 —— 真画面像素（`npm run ui:shot`，本轮新增的工具）**

把**真实渲染层**跑起来截了日志页整图（2139×1257）并逐像素分析：

- `longRuns: 0`、最长黄段仅 **2px** → **画面里没有任何黄框**；
- 那 0.3% 的"黄像素"全部是搜索框占位文字的 **ClearType 亚像素抗锯齿边缘**（放大裁剪后确认）。
- 结构自检也证明布局生效：`paperWidth: 780`、`editorBorder: 0px`、`editorFontSize: 15.5px`、
  `editorLineHeight: 30.225px`、`toolbarButtons: 14`、`mountedChips: 2`。

**结论**：黄框**不是本应用画出来的**（至少不在日志页与编辑器内容区）。
最可能是 **Windows 的「文本光标指示器」**（设置 → 辅助功能 → 文本光标，默认色偏黄橙，
画在光标处，任何程序里都有）。**待用户用 10 秒判别**：在记事本 / 浏览器地址栏打字是否也有。

**已排查完毕的三处证据**：① CSS/计算样式探针 ② 日志页真画面像素（`longRuns: 0`，最长黄段 2px）
③ 会议纪要弹窗像素（`longRuns: 0`）。本应用侧能做的排查已全部做完。

⚠️ **不要再在没有新证据的情况下"修"它。**

### ✅ 共用编辑器未被污染（本轮已可视化验证）

日志的纸张化样式全部写在 `.journal-doc` 作用域下。用 `ui:shot` 的 `sharedEditor` 自检实测：

| | 日志页编辑器 | 会议编辑器（同一个 `RichTextEditor`） |
|---|---|---|
| 边框 | **0px** | **≈1px**（盒子保留） |
| 圆角 / 字号 | 0 / 15.5px | 8px / **14px** |

会议纪要弹窗截图（`out/ui-meeting-editor.png`）肉眼确认完好。

### 🛠 新增验证工具：`npm run ui:shot`（本轮）

**本项目唯一能看到画面的手段**。用 mock `window.api` 把渲染层独立跑起来 → HTTP 托管 `out/renderer`
（`file://` 下 ES module 会被 CORS 拦）→ `capturePage()` 截图 + 结构自检 + 黄像素分析，
产物写 `out/ui-shot.png` / `out/ui-shot.json`（`out/` 已被忽略）。

**意义**：此前所有界面改动只过 `typecheck` / `build`，**从没人看过画面** ——
这正是「图片一直显示不出来却长期无人发现」的根源。**今后界面改动必须跑它**（已写进 [06](06-conventions.md) §6）。

### ⚠️ 待用户实机确认

- Phase 0 的图片内联显示（会议纪要 / 任务正文贴图）
- 日志页：左栏天列表滚动与切换、右栏纸张观感、自动保存状态、关联任务跳转、深色与 6 种强调色下的 `.journal-*`

**仍未启动过应用**：1.5.4 及之后的所有验证都停在 `typecheck` / `build` / `test:data` / 发布产物校验层面。
日志模块的**数据层已用真实数据副本验证**（8/8 PASS），但**界面从未被打开过**。

数据结构与兼容性说明见 [03-data-model.md](03-data-model.md) §9。
