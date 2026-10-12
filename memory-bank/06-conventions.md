# 06 开发约定与规范（Conventions）

> 目标：让任何一次改动都与既有代码同构，并避开已知陷阱。

## 1. 代码风格

| 项 | 约定 | 证据 |
|---|---|---|
| 缩进 / 引号 / 分号 | 2 空格、单引号、**不写分号** | 全仓一致 |
| 组件写法 | 函数组件 + `export default function Xxx({...}: Props)` | 全部组件 |
| Props 类型 | 在组件文件内定义 `interface XxxProps`，**不从共享层导入 UI 类型** | 全部组件 |
| 注释语言 | **中文**，重点写「为什么」而非「做了什么」 | 全仓 |
| 命名 | 领域词用英文（task/tag/trash/weekly/publish/postpone），其余注释与文案用中文 | 全仓 |
| 数值/文案 | 用户可见文案一律中文 | 全仓 |

**注释里保留的历史信息极有价值**：多处注释记录了「为什么不能这么写」（如禁止 `disableHardwareAcceleration`、`turndown` 必须在 `dependencies`、`registerSchemesAsPrivileged` 的时序要求）。见 [02-architecture.md](02-architecture.md) §7 —— **清理代码前先读注释，不要"顺手优化"这些写法**。

## 2. 类型约定

- **共享类型的唯一真源是 [`src/shared/types.ts`](../src/shared/types.ts)**。`src/renderer/src/types.ts` 只是它的再导出。
- 类型质量基线很高：**全项目 `any` 使用 0 处**，`as unknown` / `@ts-ignore` 均为 0。请保持。
- `tsconfig` 两侧都开 `strict: true`，但**未开 `noUnusedLocals` / `noUnusedParameters`** —— 因此未使用的 import / prop 不会报错（现存若干处，见 [07](07-optimization-backlog.md)）。
- `Task` 的更新补丁类型是 `TaskPatch`（窄），但 IPC 层实际透传 `Partial<Task>`（宽）—— 新增字段时请优先补 `TaskPatch`。

### 新增 / 修改一个 IPC 通道，必须同步改 **3 处**

1. `src/main/index.ts` —— `ipcMain.handle('域:动作', ...)`
2. `src/preload/index.ts` —— `WorkLogApi` 类型里的方法签名 + `api` 对象里的 `ipcRenderer.invoke('域:动作', ...)` 转发
3. `src/preload/index.d.ts` —— `WorkLogApi` 接口（**渲染层的 `window.api` 全局类型来自这里，漏改会导致渲染层类型缺失**）

命名格式统一为 `域:动作`（`tasks:update`、`sticky:add`、`report:exportMd`）。

### ⚠️ IPC 返回值的类型是「未经校验的断言」（真实事故）

`ipcRenderer.invoke` 返回 `any`，所以 **preload 上写的返回类型不会被 TypeScript 校验**。
主进程实际返回的形状与声明不符时，编译期**完全看不出来**。

**已发生的真实事故（1.5.4 后修复）**：`attach:saveImage` 的处理器返回 `saveAttachmentBuffer(...)`，
即对象 `{ url, file }`；而 preload 声明为 `Promise<string>`，渲染层按字符串用：
`insertHtml(`<img src="${url}">`)` → 插进去的是字面量 **`[object Object]`**
→ **任务正文与会议纪要里的图片长期无法显示**（破图图标 + alt 文件名），且不报错、不崩溃。

**规则**：
1. 跨 IPC 边界**优先返回基本类型**（string / number / boolean）或结构简单的对象；
   不要在"声明为 string"的地方返回富对象。
2. 返回值确实需要多个字段时，**preload 的类型声明必须与主进程一致**，并且**调用方要解构**。
3. 对"渲染层会直接插进模板字符串 / 当字符串用"的返回值（URL、路径、文本），
   在 preload 层加一层归一化（范例：[`src/shared/attachmentUrl.ts`](../src/shared/attachmentUrl.ts) 的
   `normalizeAttachmentUrl`，已纳入 `npm run test:data`）。
4. 主进程 handler 里避免**隐式返回 undefined**（`if (...) return` 之后没有 else），
   调用方会拿到 `undefined` 而不是 `{ ok: false }`。
5. 新增/修改 IPC 后，**必须在渲染层实际调用一次**验证形状 —— 编译通过不代表形状正确。

### 新增一个业务功能，推荐改动顺序

```
shared/types.ts 定义类型
  → src/main/<域>.ts 写领域逻辑（纯函数 + 文件读写，不碰 Electron API）
    → src/main/index.ts 注册 IPC（保持 handler 薄：编排 + 校验，重逻辑放领域模块）
      → src/preload/index.ts + index.d.ts 暴露
        → src/renderer/src/components/<功能>.tsx 写界面
          → App.tsx 加 NavItem + 渲染分支（重组件记得 lazy）
            → memory-bank/03-data-model.md + 04-features.md 登记
```

> 现有 `index.ts` 670 行承担了全部 IPC + 业务编排，是**最大的结构债**。新功能的编排逻辑若超过十几行，建议直接放进对应的领域模块，避免继续加厚 `index.ts`。

## 3. 数据层铁律

改动任何写盘路径前，先读 [03-data-model.md](03-data-model.md) §4 / §7。

1. **一切数据读写走 [`src/main/jsonStore.ts`](../src/main/jsonStore.ts)**：
   - `writeJson(file, data)` —— 原子写（同目录临时文件 + `rename` 覆盖）；
   - `readJson(file, fallback)` —— 文件不存在返回 fallback；**解析失败 / 空文件**则把原文件改名隔离为 `<file>.corrupt-<时间戳>`、发出 `data:warning` 告警、再返回 fallback；
   - `removeFile(file)`、`withDataLock(fn)`、`updateJson(file, fallback, mutate)`。
   **禁止**再自写 `fs.readFile + JSON.parse + catch { return [] }`，也**禁止**直接 `fs.writeFile` 覆盖数据文件。
2. **写锁不可重入**：`withDataLock` 是**全局串行写锁**（单用户桌面程序，一次只允许一个写事务）。**已持锁的函数不得再调用会加锁的函数** —— 会死锁。规则：
   - 叶子函数（只做单文件读改写）自己加锁；
   - 组合函数**不持锁**，让每一步各自加锁（范例：`tags.deleteTag` 先加锁改标签库、锁释放后再调 `removeTagFromAllTasks`）；
   - 读函数（`readTasks` / `readTags` / `datesOfTask` …）**不加锁** —— 原子写保证读到的永远是完整版本。
3. **区间共享任务的不变量**：同一 `task.id` 跨多天存在多份副本，`order` 是按天唯一的独立字段，其余字段全局共享。任何"改一个任务"的实现**都必须**走 `updateTask` 的同步路径（或显式复刻），否则会造成各天数据不一致。
4. **天文件读取必须走 `readTasks`（经 `taskCache` 的 mtime 缓存）**，不要直接 `fs.readFile` 天文件。`datesOfTask` 已由「任务→日期」索引支撑（写路径增量维护、查不到时回退全库扫描并回填），**不要**在它之上再叠加循环读盘。
   - 新增会改变"某任务出现在哪些天"的写路径时，**必须**同步维护索引：`indexAddTask(taskId, dates)` / `indexRemoveTask(taskId)`。
   - **外部整体替换数据后必须 `resetTaskCache()`**（导入备份、WebDAV 拉取已接好；新增同类入口记得接）。
5. **路径不要写字符串字面量**：一律用 [`src/main/paths.ts`](../src/main/paths.ts) 的导出（路径唯一真源）。各模块保留同名 re-export 只是为兼容既有调用方。
6. **不要依赖"文件为空即删除"之外的空态语义**：`writeTasks` 在 `tasks.length === 0` 时删除天文件。
7. **`tags.json` 与 `stickyNotes.json` 是裸数组**，其余业务文件是 `{ 键: [] }` 包装。新增文件请跟随「包装对象」风格（便于将来加元数据字段），并在 [03](03-data-model.md) §2 登记。
8. **附件写入的 `folder` 必须经过 `sanitizeFolder`**（`attachmentsDir` 已内置），文件名走 `sanitizeName`（已处理保留设备名 / 控制字符 / 超长）。
9. **新增数据文件必须同步考虑**：备份（`backup.ts` 整目录，自动覆盖）、WebDAV 同步（同上）、`lastDataMtime`（只扫两级，深层目录不计入）。
10. **数据层告警要能被用户看到**：需要上报的数据问题用 `reportDataWarning({ kind, file, message })`，它会经 `data:warning` 通道变成渲染层 Toast。启动期（窗口未就绪）的告警会被缓冲，在 `did-finish-load` 后补发。

## 4. 样式约定

- **颜色只用 CSS 变量**：`--bg / --panel / --border / --text / --muted / --accent / --accent-soft / --accent-ring / --danger / --success`。现存约 87 行硬编码色值属技术债，**不要增加**。
- **派生色用 `color-mix`**：`--accent-soft` / `--accent-ring` 已由 `--accent` 自动派生。新增交互态请复用，不要为每种强调色写死一套。
- **新增一种强调色只需两处**：`:root[data-accent='<name>']` 的 `--accent` 浅色值 + 深色提亮值（`[data-theme='dark']` 选择器内）。`shared/types.ts` 的 `AccentColor` 联合类型与 `SettingsModal` 的色块列表同步更新。
- **深色适配**：优先依赖变量继承；确实需要组件级覆盖时才写 `[data-theme='dark'] .xxx`（现已有 22 处，属补丁，尽量别再堆）。
- **CSS 分区注释**：新增样式追加到相关分区，**不要**新建「第六轮」这类以轮次命名的分区（现有 25 个轮次分区是本文件最大结构债）。
- CSS 中 `!important` 目前为 0 处，请保持。
- 内联 style 仅用于**运行期动态值**（标签色、进度条宽度、弹窗尺寸）；静态样式一律进 `main.css`。

## 5. 渲染层约定

- **重依赖必须 `lazy()`**：TipTap / KaTeX / 大组件。`App.tsx` 已对 10 个视图懒加载，只有 `Calendar` / `SearchBox` / `DayView` / `UpdateBubble` 是静态引入。新增页面默认 `lazy()`。`MeetingEditor`（TipTap，1.3MB chunk）与 `TaskPublish`（现为 `components/TaskPublish/TaskPublishView.tsx`）都已懒加载。
- **渲染 HTML 必须净化**：Markdown 一律走 `utils/markdown.ts` 的 `renderMarkdown`（内部已调 `sanitizeHtml`）；TipTap 等已生成的 HTML 用 `<RichView content={html} kind="html" />`（只净化、不再过 markdown-it —— 会议正文带缩进，走 markdown-it 会被判成代码块）。**禁止**直接 `dangerouslySetInnerHTML` 注入未经 `utils/sanitize.ts` 的内容。
- **日期/周计算只有一份实现**：`src/shared/date.ts`。主进程 `storage.ts` 与渲染层 `utils/date.ts` 都只是转发；**不要**在任何一侧另写一份（历史上两份实现靠注释同步，极易漂移）。
- **复用既有基元**：标签徽章用 `TagBadgeList`（收 `Map<string, Tag>`，不要手写 `task-item-tag`）；弹窗/抽屉用 `Modal` / `Drawer`（`Overlay` 的薄封装，自带焦点陷阱、ARIA、滚动锁、浮层栈）；图标按钮**必须有 `aria-label`**（`title` 不是可靠的可访问名）。
- **用户反馈走 Toast 通道**：`StatusReporter = (msg, level?) => void`，由 `App.tsx` 的 `useToasts()` 提供并作为 `onStatus` 下发给各视图。失败类消息请传 `'error'`（停留更久、描边标红）。**不要再定义只写不读的状态**（历史上 `status` 就是这样失效的）。
- **`onTasksChanged` 名字有误导性**：它只刷新日历打点（`refreshTaskDates`），**不刷新任务数据**；真正的刷新靠 `dataVersion`。
- **视图在切换页签时会被卸载**（各视图是条件渲染 `{mode === 'x' && <X/>}`，主区已不再用 `key={mode}`）。因此"有草稿的页面"**必须自己持久化或在卸载时 flush**：`TaskPublish` 的待发布列表存 localStorage，`WeeklyView` 的周总结在 cleanup 里 flush。数据新鲜度靠 `dataVersion`（App 在写操作后自增，视图把它放进取数 effect 依赖）。
- **弹窗 / 抽屉一律用 `Modal` 或 `Drawer`**（二者都是 `Overlay` 的薄封装，已含 `role="dialog"`、焦点陷阱、Escape、滚动锁、浮层栈）。**不要**自己写 overlay——会丢掉这些行为。
- **标签徽章一律用 `TagBadgeList`**（`components/TagBadge.tsx`，收 `Map<string, Tag>`）。不要在新代码里再手写 `<span className="task-item-tag">`。
- **破坏性操作目前一律 `window.confirm`**（6 处）。已有 `Modal` 基元，新增功能建议直接用 `Modal`，别再扩散原生对话框。
- 组件内的 `window.api` 调用要带 `cancelled` 守卫（现有部分 effect 缺失）。

## 6. 验证与提交

**任何改动提交前至少跑通：**

```bash
npm run typecheck      # 必须 exit 0（两侧 tsc 都跑）
npm run build          # 必须 exit 0（会暴露 vite 打包/lazy 问题）
npm run test:data      # 改了 src/main 数据层、shared/date.ts 或 utils/sanitize.ts 后必跑（54 项断言）
```

- `npm run test:data`（`scripts/test-datalayer.cjs`）用 esbuild 把被测模块打包成 CJS，在临时目录/最小 DOM 上跑真实断言，共 **54 项**：
  - **数据层**：跨天同步、索引在各写路径后的正确性、「已完成任务拒绝延期」、**损坏文件隔离且不被覆盖**、原子写无 `.tmp-` 残留、**20 个并发写不丢更新**、**回收站快照→删除→恢复闭环**（含"重复恢复不产生同 id 重复项"）；
  - **日期工具**：W01 跨年边界、2020-W53、`weekKeyToDates ↔ getWeekInfo` 往返、非法 key、跨月枚举；
  - **HTML 净化**：script 子树删除、`javascript:`、**换行混淆**、`style` 里的 `url()` 与 `position:fixed`，以及保留合法 `style` 颜色 / `data-math` / https 外链 / 表格 / `wlattach://`。
  用 domino（turndown 的依赖）提供最小 DOM，因此净化逻辑必须只用通用 DOM API（不要用 `<template>.content` / `TreeWalker`）。
- 打包后另跑 `npm run size`（安装包体积守卫，超 98MB 直接失败）。

### 界面改动必须跑 `npm run ui:shot`（**唯一能看到画面的手段**）

```bash
npm run build && npm run ui:shot            # 截图「日志」页 → out/ui-shot.png
npm run ui:shot -- 任务 out/task.png        # 截其它导航页
```

它做三件事：用 mock `window.api`（`scripts/ui-mock-api.cjs`）把**渲染层独立跑起来** →
用本地 HTTP 托管 `out/renderer`（`file://` 下 ES module 会被 CORS 拦，必须走 http）→
`capturePage()` 截图，并把**页面结构自检**（关键元素的尺寸/字号/边框）与控制台日志写进 `out/ui-shot.json`。

**为什么必须有它**：本项目长期只做 `typecheck` / `build`，界面**从没有人看过画面**，
于是出现过「图片一直显示不出来却没人发现」这类问题。**界面改动只过编译不算验证过。**

两个坑（都已写进脚本）：

1. 夹具必须**先清除 `ELECTRON_RUN_AS_NODE`**（见 `scripts/ui-shot-launcher.cjs`），
   否则 electron.exe 退化成纯 Node，`app`/`protocol` 全是 undefined。
2. **截图前必须关掉动画/过渡**（脚本里用 `insertCSS` 注入 `animation:none; transition:none`）。
   窗口是 `show:false` 的，Chromium **不推进动画时钟**，于是带入场动画的元素会**永远停在第一帧**：
   `.wl-modal` 用的 `wl-pop-in` keyframes `from { opacity: 0 }`，实测就出现过
   「弹窗的 `.editor-wrapper` 在 DOM 里存在（`inDialog:true`）但**画面里完全没有**」。
   关掉动画后元素回到自身基础样式，截图才稳定可信。**这条对任何 headless 截图都适用。**

3. **判断"有没有黄框"要看 `longRuns`（长连通黄段数），不要看 `yellowRatio`**：
   Windows 上 Chromium 用 ClearType 亚像素抗锯齿渲染文字，字符边缘天然产生大量碎黄像素
   （实测日志页 0.3%），单看比例会误报。真正的边框/色块会产生**很长的连通黄段**。
   实测日志页 `longRuns: 0`、最长黄段仅 **2px** → 画面里没有黄框。

**验证「共用组件没被污染」的用法**：`ui-shot.json` 里有 `sharedEditor` 字段 ——
它会找**不在 `.journal-doc` 里**的 `.editor-wrapper` 并报出边框/字号/圆角。
实测：日志页编辑器 `border 0px / 15.5px`，而会议编辑器 `border ≈1px / 圆角 8px / 14px`
→ 纸张化样式确实只作用于 `.journal-doc`，没有泄漏到会议纪要。

4. **点击目标必须精确匹配后再退回 `includes`**。曾经用 `includes('编辑')` 去点右侧的「编辑」按钮，
   结果先命中了左栏天列表里**预览文字含「编辑器」**的那一天，夹具点错目标、还把当天切走了 ——
   **看起来完全像产品 bug**。脚本现在先找 `textContent.trim() === want`，找不到才用 `includes`，
   并在日志里区分 `clicked-exact` / `clicked-loose`。
5. **截图前必须强制重绘**（`webContents.invalidate()` + 一次 1px 尺寸抖动）。
   隐藏窗口会给出**过期的合成帧**：实测出现过「截图紧前刚查过 DOM，确认已是写态
   （14 个工具按钮、按钮文案=完成），但截出来的 PNG 仍是上一次的读态画面」。
   脚本因此在 capture 前再取一次状态并打印成 `截图前状态`，便于把
   「状态没变」和「画面过期」区分开 —— **不要一看到截图不对就以为是产品坏了。**

### 用 `ui:shot` 驱动多步交互

第 3 个参数是**依次点击**的列表，用 `|` 分隔；每步可写成 `选择器::文字`（在该选择器范围内找按钮）：

```bash
npm run ui:shot -- 日志 out/p.png "选择日期|.dp-pop::15|开始写"
```

再配合两个环境变量：

- `WL_MOCK_TYPE=1` —— 真的往编辑器里插一个字（**必须先 focus 到 contenteditable，再用
  `execCommand('insertText')`**；只用 `sendInputEvent` 不行，因为点完按钮后焦点还在按钮上，
  按键进不了编辑器），然后等过自动保存的防抖时间。
- mock 会把每次 `saveJournalDay` 记下来，通过 `window.api.getMockSaves()` 读出。
  这是验证**「写到哪一天」**这类数据路径的唯一手段：实测「挑 10-15 → 写 → 保存」
  记录为 `[{"date":"2026-10-15",...}]`，证明存的确实是**挑中的那天**，
  而不是今天或上一次加载的那天。
- `WL_MOCK_SEARCH=关键字` —— 往顶部搜索框里真的输入（同样必须走 `execCommand('insertText')`，
  直接改 `.value` 不会触发 React 的 `onChange`），用来驱动「搜索 → 命中 → 跳转」。
  自检里的 `activeNav` 会报出当前激活的导航项，所以**「跳到了哪一页」是可断言的**：
  实测从「任务」页搜到一条日志命中并点击后，`activeNav` 变成「日志」、
  正文标题变成命中项的那一天（`10月6日 周二`）。
- 存量的 `tsc` 无 lint（项目**没有** ESLint / Prettier 配置，风格靠人工一致）。代码里的 `// eslint-disable-next-line react-hooks/exhaustive-deps` 是历史遗留注释，当前**不会**被任何工具执行。
- 涉及数据层的改动建议额外用 `logs/` 下的真实数据手工验证（开发模式数据就在仓库 `logs/`）。
- 提交信息风格：`fix: ...` / `feat: ...` / `docs: ...` / `chore: ...`，发版提交为 `v<版本>: <摘要>（发布 <版本>）`。

## 7. 发布流程

```bash
# 1) 升版本
#    package.json  version → x.y.z
# 2) 写发布说明（两处，内容一致）
#    CHANGELOG.md 顶部新增 "## [x.y.z] - YYYY-MM-DD" 章节
#    src/renderer/src/data/releaseNotes.ts 数组最前面插入同内容条目
# 3) 提交
git commit -m "v x.y.z: ...（发布 x.y.z）"
# 4) 构建 + 打包 + 发布（两端）
npm run publish:gitee
npm run publish:github     # 需要环境变量 GH_TOKEN（+ GH_OWNER / GH_REPO）
# 5) 打标签（两端同步）
git tag -a vx.y.z -m "说明"
git push origin master --tags
git push github master --tags
```

### 发版前必查（1.5.4 实际踩到的坑）

1. **Gitee 附件配额是 1 GB 累计，不是单文件 100MB。** 仓库已有十几个 ~95MB 的安装包，
   1.5.4 发布时已用 966 MB、仅剩 57.7 MB，**上传直接失败**（`文件大小已超出仓库附件配额：1 GB`）。
   发版前先核对配额，必要时删除最老的 beta / 旧版本发行版释放空间。
   （删除旧发行版**不影响自动更新** —— 更新只读 `releases/latest`；只是无法再手动下载那些旧安装包。）
2. **`GH_TOKEN` 只对 `api.github.com` 生效**（发行版创建 + 附件上传）。`git push` 走 `github.com`，
   需要 git 凭据（Git Credential Manager）或代理；两者不是一回事。
3. **发行版会抢先创建 tag**：`publish-*.ps1` 创建发行版时若 tag 不存在，平台会自动在**当前远端 HEAD**
   处建 tag。因此**必须先 `git push master` 再打 tag**，否则远端 tag 会指向上一个版本（1.5.4 就这样错位过，
   已用 `git push origin refs/tags/v1.5.4 --force` 纠正）。正确顺序：
   **先 push 代码 → 再 publish → 最后 push tag**（或 publish 后强制纠正 tag）。
4. **Gitee 附件不能直接用 `browser_download_url` 下载（会 403）**，必须走 API 端点
   `/releases/{id}/attach_files/{fileId}/download?access_token=…`（`src/main/updater.ts` 就是这么做的）。
5. **每次 publish 都会重新构建安装包**，两次构建的安装包**字节不同**（sha512 不同）。因此
   「两端 sha512 不一致」是**正常的** —— 只要每个平台的 `latest.yml` 与**同平台**的安装包一致即可。
   验证时必须**分别**用各平台的 yml 去校验该平台的安装包，不能拿本地 `dist/` 去比对另一端。

**注意事项**

- 发布脚本从 `CHANGELOG.md` 取「当前 `package.json` 版本号」对应章节作为 Release 备注；章节标题 `## [版本号]` / `## 版本号` / `## v版本号` 均可；也可用 `-- -Message "备注"` 手动指定。
- Gitee 令牌填在 `src/main/updater-config.ts`（**被 .gitignore 忽略**）；GitHub 用环境变量 `GH_TOKEN`。
- **安装包必须 < 100MB**（Gitee 发行版附件上限）。1.5.3 实测 **98.99MB，余量已极薄** —— 任何新增依赖前先评估体积影响，见 [07](07-optimization-backlog.md) P1-5。
- 安装包未做代码签名，SmartScreen 提示属正常。
- `dist/` 与 `logs/` 都在 `.gitignore` 中，不要提交。

## 8. 文档维护约定

改动代码后**必须**同步更新记忆库（否则下一个会话会读错）。对照表：

| 改了什么 | 更新哪个文件 |
|---|---|
| 功能新增 / 删除 / 交互变化 | `04-features.md`（并在 `05-progress.md` 记录） |
| 数据结构 / 文件路径 / 备份同步范围 | `03-data-model.md` §2、§6 |
| 新增或改名 IPC 通道、主进程模块 | `02-architecture.md` §2、§3 |
| 组件职责 / 数据流约定变化 | `02-architecture.md` §4 |
| 依赖增删、构建产物、打包配置 | `01-project-brief.md` §技术栈、`02-architecture.md` §5 |
| 发布新版本 | `05-progress.md` §2 版本历史 |
| 修掉或新增技术债 | `07-optimization-backlog.md`（修掉的移入「已完成」） |
| 任何一轮工作结束 | `session-log.md` 追加一条 |
