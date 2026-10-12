# 02 架构与 IPC 契约（Architecture）

> 逐模块的详细签名与 file:line 见附录 [appendix-main-process.md](appendix-main-process.md) 与 [appendix-renderer.md](appendix-renderer.md)。

## 1. 三进程结构

```
┌─────────────────────────── Electron 主进程 (src/main/) ───────────────────────────┐
│  index.ts —— 应用生命周期 + 全部 IPC 路由 + 业务编排（670 行，单点最重）           │
│  领域模块：tasks / tags / trash / weekly / history / exporter / meta / stickyNotes │
│            search / stats / backup / migrate / sync / attachments / meetings       │
│            meetingExport / tray / updater / storage（无数据库，直接读写 JSON 文件） │
└────────────────────────────────────┬──────────────────────────────────────────────┘
                                     │ ipcMain.handle  ↔  ipcRenderer.invoke
┌────────────────────────────────────┴──────────────────────────────────────────────┐
│  preload (src/preload/) —— contextBridge 暴露 window.api（42 个方法），纯转发      │
│  类型声明 index.d.ts 同时是渲染层的全局类型来源（declare global Window.api）        │
└────────────────────────────────────┬──────────────────────────────────────────────┘
                                     │ window.api.*
┌────────────────────────────────────┴──────────────────────────────────────────────┐
│  渲染层 (src/renderer/src/) —— React 19 SPA                                      │
│  App.tsx 唯一状态中枢 → 纯 props 下钻 + 回调上行，无 Router / Context / store      │
│  组件见 §4；样式单文件 assets/main.css（5090 行，37 个顶层分区）                   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### 关键安全 / 运行配置（`main/index.ts` `createWindow`）

- `contextIsolation: true`、`sandbox: false`、`nodeIntegration` 未开启（默认 false）→ 渲染层**不能**直接用 Node，只能走 `window.api`。因此 §6 的 XSS 面风险等级为**中低**（无法直接 require('child_process')），但页面内脚本仍可读全部业务数据、调用全部 IPC。
- `mainWindow.removeMenu()` —— 真正移除菜单栏（`autoHideMenuBar` 只隐藏，按 Alt 仍会弹出默认菜单）。同时 `Menu.setApplicationMenu(null)`。
- 关闭窗口 = **隐藏到托盘**（`close` 事件 `preventDefault` + `hide`），真正退出走托盘菜单 / `isQuitting`。
- 外链一律 `shell.openExternal`，窗口内导航被拒。
- `app.requestSingleInstanceLock()` 单实例；第二个实例只聚焦已有窗口。
- `app.commandLine.appendSwitch('disable-features','CaretLineHighlight')`（修编辑器黄框）、`disable-gpu-shader-disk-cache`、`disk-cache-size=0`。
- **禁止再调用 `app.disableHardwareAcceleration()`**：禁用 GPU 会退回 SwiftShader 软件渲染，弹窗遮罩 blur / 阴影 / 动画全部卡顿（1.5.2 曾踩坑并回退）。要压内存只能从渲染层懒加载入手。
- 自定义协议 `wlattach://`：`registerSchemesAsPrivileged` 在**模块顶层**（必须早于 app ready，且有 `typeof protocol !== 'undefined'` 保护 —— electron-vite dev 模式下该对象可能尚未初始化）；`protocol.handle` 在 `whenReady` 内注册。

## 2. IPC 通道全表

`src/main/index.ts` 注册，`src/preload/index.ts` 一一对应转发。**共约 60 个通道**。

| 域 | 通道 | 说明 |
|---|---|---|
| 存储 | `storage:root` | 返回 R，设置页展示 |
| 任务 | `tasks:read` / `tasks:readMany` / `tasks:listDates` | 读天文件 / 批量 / 列出所有有任务的日期 |
| | `tasks:create` / `tasks:update` / `tasks:delete` / `tasks:reorder` | CRUD；`update`/`delete` 会自动跨天同步（见 [03](03-data-model.md) §4） |
| | `tasks:trash` | 删除单任务 → 进回收站（先按 id 收集**所有天**的副本组成一条） |
| | `tasks:datesOf` | 该任务当前出现的所有日期（延期弹窗用） |
| | `tasks:postpone` | 追加新区间（同 id 共享，重叠日期跳过，已完成拒绝） |
| | `tasks:publish` | 批量/区间发布，并在**同一 handler 内**写发布历史 |
| 标签 | `tags:list` / `tags:create` / `tags:rename` / `tags:recolor` / `tags:delete` | `create`/`rename` 重名返回 `null`；`delete` 联动清除所有任务与子任务上的引用 |
| 回收站 | `trash:list` / `trash:restore` / `trash:remove` / `trash:clear` | `restore` = 取出 + 重放回各自日期 |
| 发布历史 | `history:list` / `history:delete` / `history:trash` | `history:trash` = 整批进回收站再删记录 |
| 周报 | `weekly:info` / `weekly:read` / `weekly:write` / `weekly:shift` | `shift` 由主进程算周偏移 |
| 设置 | `settings:get` / `settings:set` | `set` 时联动 `setUpdateSource` |
| 搜索 / 统计 | `search:tasks` / `stats:range` | 全库扫描，无索引 |
| 节假日 | `holiday:fetch` | `net.fetch` timor.tech，按年 |
| 导出 | `export:md` / `report:exportMd` / `report:exportWord` | 各带一次 SaveDialog + 写文件 |
| 备份 / 同步 | `backup:export` / `backup:import` / `sync:push` / `sync:pull` / `sync:localMtime` | 导入与拉取后都会 `resetMigration` |
| 附件 | `attach:saveImage` / `attach:pickFile` / `attach:open` / `attach:delete` | `saveImage` 的 `folder` 经 `sanitizeFolder` 净化、写入路径有 resolve+前缀双校验（P3-2 已修）；**返回值必须是 url 字符串**（1.5.4 后修，见 [06](06-conventions.md) §2） |
| 会议 | `meetings:list` / `meetings:save` / `meetings:delete` / `meetings:export` | 每会议一个 `meetings/<id>.md.json`；`delete` **必须显式返回 `{ ok: true }`**（该函数是 `Promise<void>`） |
| 便签 | `sticky:list` / `sticky:add` / `sticky:update` / `sticky:delete` | `sticky:add` 缺 `Array.isArray` 守卫（见 [07](07-optimization-backlog.md) P4-1） |
| **日志** | `journal:listDates` / `readDay` / `listRange` / `saveEntry` / `deleteEntry` | `logs/journal/<年>/<日期>.json`，一天一文件可多条；写入走 `jsonStore`；**日期强校验**；失败显式返回 `{ ok:false, … }` |
| 系统 / 更新 | `app:getInfo` / `update:check` / `update:download` / `update:cancel` / `update:install` / `update:set-source` | 开发模式下 check/download 直接拒绝；`update:cancel` 取消进行中的下载（含超时看门狗） |

**事件推送通道（2 条）**：

1. `update:event`（主进程 `broadcastUpdate` 广播给所有窗口），payload 形如
   `{ channel, payload }`，内层 `channel ∈ checking | available | not-available | progress | downloaded | cancelled | error`。
   preload 的 `onUpdateEvent(cb)` 返回取消订阅闭包。**App.tsx 与 SettingsModal.tsx 各自订阅了一次**（App 侧用 `settingsOpenRef` 在设置页打开时让路）。
2. `data:warning`（`broadcastDataWarning`）—— 数据层告警：文件损坏被隔离、写盘失败、回收站超限。
   payload 为 `DataWarning { kind, file, message, quarantine? }`。**启动期窗口未就绪时先缓冲**，在 `webContents` 的 `did-finish-load` 后补发（否则启动期迁移发现的数据问题会被吞掉）。
   preload 的 `onDataWarning(cb)` 返回取消订阅闭包。

## 3. 主进程模块职责速查

| 模块 | 一句话职责 |
|---|---|
| `index.ts` | 生命周期 + 全部 IPC + 业务编排（回收站组装、发布历史、自动同步调度、导出对话框） |
| **`jsonStore.ts`** | **数据层公共设施**：原子写（临时文件 + rename）、区分 ENOENT 与解析失败（损坏文件改名隔离 + 告警）、全局串行写锁 `withDataLock`、告警出口 |
| **`paths.ts`** | **数据文件路径唯一真源**（原先路径字面量散落 8 处，`migrate.ts` 还硬编码过） |
| **`../shared/date.ts`** | **日期与 ISO 周的唯一实现**（`toDateStr`/`weekdayName`/`getWeekInfo`/`weekKeyToDates`/`enumerateDates`），主进程与渲染层共用；`storage.ts` 与 `renderer/utils/date.ts` 只是转发 |
| **`taskCache.ts`** | 天文件 mtime 缓存 + 「任务 → 日期」增量索引，支撑 `datesOfTask` 的 O(1) 查询 |
| `storage.ts` | R 解析与数据目录迁移；`toDateStr` / `weekdayName` / `getWeekInfo` / `weekKeyToDates` / `enumerateDates` |
| `tasks.ts` | 任务 CRUD、跨天共享同步、发布 / 延期 / 回收站重放 / 标签引用清理 |
| `tags.ts` | 标签库 CRUD + 用量统计 + 删除联动 |
| `trash.ts` | `trash.json` 整批条目 CRUD（500 条安全阀；恢复用 `findTrashItem` 后重放成功才删除） |
| `weekly.ts` | 周总结读写 + 周导航；周总结为空则删除文件 |
| `history.ts` | 发布批次记录读写（`{records:[]}` 包装） |
| `exporter.ts` | 纯函数式 Markdown 生成（日 / 周 / 区间），不写盘 |
| `meta.ts` | `settings.json` 读写 + 逐字段兜底默认值 |
| `stickyNotes.ts` | 便签 CRUD；**唯一实现串行写锁**（`withNotesLock`） |
| `search.ts` | 全库内存检索，命中标题 / 子任务标题 / 标签名 / 正文（正则去 HTML），最多 50 条 |
| `stats.ts` | 任意区间统计（复用 `MonthStats`），逐日 `readTasks` |
| `backup.ts` | zip 整目录导出 / 解压合并导入 |
| `migrate.ts` | 一次性历史迁移，标记 `.migrated-v1.2` |
| `sync.ts` | WebDAV 上传/下载（远端单文件 `worklog-logs.zip`）+ `lastDataMtime` |
| `attachments.ts` | 附件落盘 + `wlattach://` URL 生成与解析 |
| `meetings.ts` | 会议纪要文件 CRUD + 附件目录管理 |
| `meetingExport.ts` | turndown HTML→Markdown，单篇会议导出 |
| `tray.ts` | 托盘图标（运行时自绘 PNG，含手写 CRC32）+ 每 30 秒轮询提醒 |
| `updater.ts` | 自研双镜像更新：检测 → 下载 → sha512 校验 → 拉起安装包 |
| `updater-config.ts` | **被 .gitignore 忽略**的令牌配置（明文 token 会打进安装包，属已知取舍） |

## 4. 渲染层结构

### 4.1 导航与页面

`App.tsx` 的 `Mode` 联合类型 + `NAV_ITEMS`（10 项）+ `NAV_GROUPS`（4 组）：

| 分组 | key | 组件 | 加载 |
|---|---|---|---|
| 日志 | `day` | `DayView` | 静态 |
| 日志 | `week` | `WeeklyView` | lazy |
| 任务 | `publish` | `TaskPublish` | lazy |
| 分析 | `stats` | `StatsView` | lazy |
| 分析 | `report` | `ReportView` | lazy |
| 管理 | `tags` | `TagManager` | lazy |
| 管理 | `sticky` | `StickyNotesView` | lazy |
| 管理 | `meeting` | `MeetingList` | lazy |
| 管理 | `trash` | `TrashView` | lazy |
| 管理 | `announce` | `AnnouncementsView` | lazy |

静态引入的只有 `Calendar` / `SearchBox` / `DayView` / `UpdateBubble`，其余 10 个 `lazy()` —— 目的是让 TipTap / KaTeX 等重依赖延后进内存。

### 4.2 状态与数据流约定（**改前端前必读**）

- `App.tsx` 是**唯一**状态中枢：`date` / `mode` / `weekKey` / `daySel{date,taskId}` / `settings` / `tags` / `taskDates:Set` / `status` / `settingsOpen` / `calOpen` / `updateBubble` / `collapsedGroups`（localStorage `wl-nav-collapsed`）。无 Router、无 Context、无 store、无 ErrorBoundary、无 StrictMode。
- 三条上行回调主线：
  1. `onStatus(msg, level?)` → Toast（`useToasts` 收集，右下角气泡栈展示，错误级停留更久并标红）。**这是 1.5.1「底部状态栏」被移除后的替代通道**；此前 `status` 从未被渲染，所有反馈（含全部错误提示）都被静默丢弃。
  2. `onTasksChanged` / `onPublished` / `onRestored` → `refreshTaskDates()`。**名字有误导性：它只重拉 `listTaskDates` 刷新日历打点，不刷新任务数据。**
  3. `onChanged`（TagManager）→ `refreshTags()`。
- **刷新模型 = 每个视图自己重拉**。为避免"靠切页重挂载来刷新"，`App.tsx` 维护 `dataVersion` 版本号：任何写操作后自增（`refreshTaskDates` / `refreshTags`），`DayView` / `WeeklyView` / `TaskPublish` / `StatsView` / `TrashView` / `StickyNotesView` 把它放进取数 effect 的依赖里。主区已**不再**使用 `key={mode}`。
- **草稿不再依赖"页面不被卸载"**：各视图是条件渲染，切换页签必然卸载。因此 `TaskPublish` 的待发布列表持久化到 localStorage（`wl-publish-draft`），`WeeklyView` 的周总结在切周/卸载时 flush 未落盘的防抖写入。
- **共用基元**：`Modal` 与 `Drawer` 都是 [`Overlay.tsx`](../src/renderer/src/components/Overlay.tsx) 的薄封装，行为（Escape / 遮罩点击 / 焦点陷阱 / `role="dialog"` / 滚动锁 / 浮层栈）在 Overlay 中统一实现；标签徽章统一走 [`TagBadge.tsx`](../src/renderer/src/components/TagBadge.tsx) 的 `TagBadgeList`（收 `Map<string, Tag>`）。
- **HTML 渲净化**：[`utils/sanitize.ts`](../src/renderer/src/utils/sanitize.ts) 是唯一的净化实现（默认拒绝的允许列表）；`renderMarkdown` 出口已内置，TipTap 原始 HTML 走 `RichView kind="html"`。**任何 `dangerouslySetInnerHTML` 都必须先过它**。
- **任务发布模块已拆目录**：`components/TaskPublish/` = `TaskPublishView.tsx`（主组件 + 两个抽屉）+ `PendingTaskCard.tsx` + `PublishedList.tsx` + `types.ts`。
- 主题：单个 effect 把 `settings.theme` / `accent` 写到 `<html data-theme / data-accent>`。system 模式只在 settings 变化时读一次 `matchMedia`，**未订阅系统主题变化**。
- 懒加载 `Suspense` fallback（`App.tsx:295`）引用了**不存在**的 CSS 变量 `--text-secondary`（应为 `--muted`）。

### 4.3 样式架构（`assets/main.css`）

- **16 个 CSS 变量**全部定义在 `:root`，0 个未使用：`--bg / --panel / --border / --text / --muted / --accent / --accent-soft / --accent-ring / --danger / --radius{,lg,xl} / --shadow-{sm,md,lg,card}`。
- **深色**：`:root[data-theme='dark']` 只覆盖 6 个基色 + `--accent-soft`，另有 **22 处**组件级 `[data-theme='dark'] .xxx` 补丁。
- **强调色**：6 组 (`blue/indigo/violet/green/rose/amber`) 各有浅色与深色提亮值；`--accent-soft` / `--accent-ring` 用 **`color-mix`** 从 `--accent` 自动派生 —— **新增一种强调色只需一行**，是本文件最干净的设计，务必沿用。
- **37 个顶层分区**，其中第 13–37 共 25 个以「轮次 / 版本号」命名（`v3.1`…`v3.7`、`第三轮`…`第五轮`），主题高度交叉、后写覆盖先写，形成层叠补丁链。`!important` 0 处，`@media` 仅 1 条。
- 硬编码色值约 87 行；tsx 内联 style 约 40 处（标签色 / 进度条宽度 / 尺寸）。
- 悬空变量：`--fg`（`main.css:3539` 使用，从未定义）。

## 5. 构建与打包

```
electron.vite.config.ts
  main / preload → externalizeDepsPlugin()   # 依赖不打包，运行时从 node_modules require
  renderer      → react()                    # 全部打包进 out/renderer
```

`out/` 产物（1.5.4 开发中实测，`npm run build`）：

| 产物 | 大小 |
|---|---|
| `index-*.js`（主包，含 React + DayView 链） | 862 kB |
| `MeetingList-*.js`（TipTap + prosemirror + lowlight） | **1,346 kB** |
| `katex-*.js`（动态 import，仅含公式时加载） | 485 kB |
| `index-*.css` | 103 kB |
| 合计 | 3.15 MB |

`electron-builder.yml` 要点：

- `files: [out/**, package.json]`，`asar: true`；`extraResources` 只带 `build/icon.png`。
- `compression: maximum` —— 为满足 **Gitee 发行版附件 100MB 上限**（1.5.3 安装包实测 98.99 MB，余量已很薄）。
- `afterPack: scripts/after-pack.js` 裁剪 Electron 语言包等。
- NSIS：`oneClick: false`、`allowToChangeInstallationDirectory`、`perMachine: false`、`include: build/nsis-preserve-logs.nsh`（更新前备份 logs）。
- 保留 `publish: generic` 仅为让 electron-builder 生成 `latest.yml`；**实际发布由 `scripts/publish-*.ps1` 走 API 完成**，运行时更新也**不用 electron-updater**（`updater.ts` 自研）。

## 6. 安全边界现状

| 项 | 现状 | 风险 |
|---|---|---|
| 渲染层 Node 访问 | `contextIsolation: true` + `sandbox: false` + 无 `nodeIntegration` | 低 |
| Markdown / HTML 渲染 | ✅ **已加固（P3-1）**：`utils/sanitize.ts` 默认拒绝的允许列表 + `renderMarkdown` 出口内置净化；`MeetingDetail` 改走 `RichView kind="html"` | 低 |
| 会议详情 | ✅ 已改用 `RichView`（同一净化出口），不再自己 `dangerouslySetInnerHTML` | 低 |
| 附件写入 | ✅ **已加固（P3-2）**：`sanitizeFolder` 丢弃 `.`/`..`/空段 + `attachmentsDir` 做 `resolve` 前缀校验（与读取侧对称）；`sanitizeName` 处理保留设备名/控制字符/超长 | 低 |
| 备份导入 | ✅ **已加固（P3-12）**：`assertSafeZipEntries` 在解压前拒绝绝对路径与含 `..` 的条目（zip-slip） | 低 |
| WebDAV 凭据 | `settings.json` **明文**存储，且随备份 zip 一起上传到 WebDAV 远端 | 已知取舍，需在文档提醒 |
| 更新安装包 | 无代码签名、无签名校验，sha512 只比对 `latest.yml` 声明值 | 已知取舍 |

## 7. 环境适配的"坑"注释（改动前务必先读代码里的中文注释）

代码库里有几处**看起来多余、实为踩坑修复**的写法，不要"顺手清理"：

1. `scripts/electron-vite.cjs` 删除 `ELECTRON_RUN_AS_NODE`（否则 electron 退化为 Node 模式启动即崩）。
2. `protocol.registerSchemesAsPrivileged` 的 `typeof protocol !== 'undefined'` 保护 + `appendSwitch` 放在 `whenReady` 内（electron-vite dev 下对象未初始化）。
3. 禁止 `disableHardwareAcceleration()`（见 §1）。
4. **编辑器「黄框」**：`main.css` 的「编辑器：焦点环与黄框」分区。**曾经的 `caret-line-highlight: none` 是无效 CSS**
   （Electron 探针实测 `CSS.supports('caret-line-highlight','none') === false`，浏览器解析时直接丢弃，连 `cssText` 都扫不到），
   主进程的 `--disable-features=CaretLineHighlight` / `disableBlinkFeatures` 也未找到对应特性名。
   真正补上的是 `.rich-editor-content .ProseMirror { outline: none }`（原先所有 `outline:none` 只作用于只读的 `.rich-content`）。
   ⚠️ 用户仍反馈过「内容区有黄框」，但探针在编辑态元素上**查不到任何黄色**（outline/border/box-shadow 全无黄色，`main.css` 里黄色系规则 0 条），
   **成因仍未确诊**，需要用户截图 + 判别性测试（在其他程序里是否也有）才能定位。
5. `Calendar` 的「更新日历」人为保证转圈 ≥800ms —— 静态年份数据会瞬间返回，否则用户看不到任何反馈。
6. `turndown` / `turndown-plugin-gfm` 必须在 `dependencies`（曾在 devDependencies 导致打包后启动崩溃）。
7. `publish-gitee.ps1` 需 UTF-8 BOM（PowerShell 5.1 否则按 ANSI 读取解析出错）；Gitee 发布脚本 JSON Body 必须按 UTF-8 字节发送（否则中文发布说明乱码）。
8. `updater-config.ts` 的 Gitee 段必须写在 GitHub 段之前（发布脚本按首次出现读取）—— 脆弱的隐式契约。
