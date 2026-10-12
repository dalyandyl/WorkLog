# 会话日志（Session Log）

> **追加式**记录，只增不改（除更正事实错误）。每条：日期 / 做了什么 / 结论与决定 / 遗留。
> 新会话开始时读最近 2–3 条即可恢复上下文；更早的内容已被吸收进其他记忆库文件。

---

## 2026-10-10（第十九轮）—— ⛔ **项目整体回退到 1.5.3**（用户决定）

> **本条之后的代码与文档不再一致**：这一条之后，`src/` 是 1.5.3 的代码，
> 而本文件更早的条目、以及 memory-bank 的其余文档，描述的都是 **1.5.4 那条线**。
> 它们是**历史参考**，读时必须对照代码核实。

**用户的请求（原话要点）**：「我查验了 1.5.4，发现了很多问题，现在回退所有代码变动
包括上面基于 1.5.4 新做的更新全部回退，代码回退到 1.5.3，因为 1.5.3 是我另一台电脑
正在使用的稳定版本。」

**为什么要提前确认**：回退会**删掉 12 个文档与 1.5.4 的全部代码**，其中
`memory-bank/` + `AGENTS.md` **在 1.5.3 里根本不存在**（它们是 1.5.4 那批工作才加的）。
向用户确认后，用户选择 **保留文档**。

**执行内容**

| 项 | 结果 |
|---|---|
| 回退范围 | `git reset --hard c147397`（1.5.3），撤销 **24 个提交 / 89 个文件 / +10457 −2135 行** |
| 文档 | 从备份取回 `memory-bank/`（11 个文件）+ `AGENTS.md`，**代码基线是 1.5.3** |
| 安全网 | 分支 `backup/1.5.4-journal-work` + 标签 `archive/1.5.4-and-journal`（都指向 `6cf45c3`） |
| 依赖 | `npm install` 对齐 1.5.3 的 `package-lock.json` |
| 验证 | `typecheck` exit 0、`build` exit 0（1.5.3 基线可正常构建） |
| AGENTS.md | **重写为与 1.5.3 一致** —— 原先它写着"所有数据读写必须走 jsonStore.ts"等，而那些文件已被删除，留着会误导后续会话 |
| 过渡版 | 版本号升到 **`1.5.5-beta1`**（内容 = 1.5.3），目的是让已经升到 1.5.4 的机器能被更新器接回稳定基线 |

**过渡版为什么能生效（已实测确认，不是猜的）**

- 两个发布脚本（`publish-gitee.ps1:136`、`publish-github.ps1:141`）都把 `prerelease` **硬编码为 `$false`**
  → 带 `-beta` 的版本号也会作为**正式发行版**发布，因此 `GET /releases/latest` 能取到它
  （更新器读的就是 `releases/latest`；GitHub 的该接口会**排除** prerelease，若真标了 prerelease 就永远收不到）。
- 更新器用 `semver.gt(远端, app.getVersion())` 判断（`updater.ts:129`），
  `semver.gt('1.5.5-beta1','1.5.4')` **成立** → 1.5.4 的机器会看到这一版。

**这次回退撤掉了什么（要点，便于日后按需重新引入）**

1. **P0–P3 系统性优化**：`jsonStore.ts`（原子写 + 损坏文件隔离 + 全局写锁）、`paths.ts`、`taskCache.ts`
   （任务→日期索引）、`utils/sanitize.ts`（HTML 净化）、`Toast.tsx` / `Overlay.tsx` / `TagBadge.tsx`、
   `shared/date.ts`（日期唯一实现）、`lastDataMtime` 递归修正。
2. **「日志」模块**（一天一篇连续文档 + 左栏天列表 + Word 式纸张 + 读/写态 + 关联任务）。
3. **图片永远显示不出来的根因修复**：`attach:saveImage` 返回对象而 preload 声明 `string`，
   对象被插进模板字符串变成 `[object Object]`。**这条教训与版本无关，已单独写进 AGENTS.md 铁律 3。**
4. **`meetings:delete` 的 IPC 契约修复**（返回 `undefined` 而声明 `{ok}`）。
5. 测试（`test:data` 112 项）与界面截图工具（`ui:shot`）。

⚠️ **代价**：回退后**数据写入不再是原子的、读失败会被当成空数据**。这是 1.5.3 原有的风险，
改数据层时要留意（详见 AGENTS.md 顶部说明与 03-data-model 的相关章节）。

**遗留 / 待办**

- 过渡版尚未发布（本条目写下时正在准备）。
- 两个远端的 `master` 也需要一起回退（用户已确认）。
- 用户**没有说明 1.5.4 具体发现了哪些问题** —— 后续若要重新引入上面那些改动，
  应先问清楚，避免把被否决的东西原样再搬回来。

---

## 2026-10-10（第十八轮）—— 补上「任意日期写入」的端到端验证（含数据落点）

**本轮背景**：上一轮修完用户提的四个问题后，我意识到有个**验证缺口** ——
我确认了「选择日期」按钮**存在**，但从未证明它**真的能切日期、真的能写、而且真的写到那一天**。
用户提的正是"手动添加填写任意日期的日志"，所以这条必须验。

**给夹具加了两项能力**

1. **多步 + 作用域点击**：第 3 个参数改成 `|` 分隔的点击序列，每步可写 `选择器::文字`。
   ```bash
   npm run ui:shot -- 日志 out/p.png "选择日期|.dp-pop::15|开始写"
   ```
2. **数据落点探针**：mock 记录每次 `saveJournalDay(date, …)`，通过
   `window.api.getMockSaves()` 读回；配合 `WL_MOCK_TYPE=1` 真的往编辑器里插一个字。

**第一次尝试就踩了一个坑（又是夹具问题）**

用 `sendInputEvent` 发按键 → 编辑器里**什么都没发生**，`saveJournalDay` 记录为空。
原因：点完「开始写」后**焦点还在按钮上**，按键根本没进 contenteditable。
改为 `pm.focus()` + `document.execCommand('insertText', …)`（ProseMirror 靠 beforeinput/input 更新，
必须走真正的输入事件），`onUpdate` 才发火。

**验证结果（端到端，含数据落点）**

```
点击 选择日期        → exact → "选择日期"
点击 .dp-pop::15     → exact → "15"
点击 开始写          → exact → "开始写"
输入模拟: insertText=true text=X
mock 记录的 saveJournalDay 调用: [{"date":"2026-10-15","bodyLength":8}]
heading: 10月15日 周四      editorPresent:true   toolbarButtons:14
```

**关键点**：保存的日期是 **`2026-10-15`** —— 用户**挑中的那一天**，
既不是今天（2026-10-10）也不是上一次加载的那天。这正好证明上一轮修掉的
「切日期时编辑器用旧内容挂载 / 写到错误日期」的隐患**真的解决了**，而不只是代码看起来对。

**验证**：`typecheck` exit 0；`build` exit 0；`test:data` 112/112。

**同轮追加：验证我改过但没验过的另一条路径 —— 全局搜索 → 日志页跳转**

上一轮我把 `onPickJournal` 从「顺手改全局 date」改成了 `jumpTo={{date,nonce}}` 令牌，
但这条路径**一直没验**。给夹具加了 `WL_MOCK_SEARCH=关键字`（往搜索框真的输入，
同样必须走 `execCommand('insertText')`），并让自检报出 `activeNav`（当前激活的导航项），
于是"跳到了哪一页"变成可断言的：

```
点击「任务」: clicked
搜索命中: 2 条  ["2026-10-07任务买苹果派原料…", "2026-10-06日志日志…记一下苹果派的做法…"]
点击 .search-results::2026-10-06 → loose → "2026-10-06日志"
activeNav: "日志"            ← 视图确实切到了日志页
heading: "10月6日 周二"      ← 而且落在命中项那一天
```

**同轮追加 3：验证用户**第 1 条**抱怨本身 —— 那个「点了没反应」的加号**

夹具再支持 `sel=选择器`（点纯图标按钮，没有文字可匹配）。

```
点击 选择日期 → exact "选择日期"
点击 .dp-pop::15 → exact "15"            ← 先切到一个空白日期 2026-10-15
点击 sel=.journal-days-head button       ← 点那个加号
heading: "10月10日 周六"                  ← 回到今天
editorPresent:true toolbarButtons:14 按钮=完成   ← 并且直接进入写态
```

即：加号从"什么都不做"变成了"跳回今天并开始写"，**用户第 1 条抱怨闭环**。

**顺带说明一处与目标原文的偏差**：目标第 (4) 条写的是"顶部**常驻**一条工具条"，
但用户后续明确反馈"一直处于编辑状态"是问题，因此工具条现在**只在写态出现**。
以用户的最新指令为准，已记入 [04](04-features.md) §0。

---

## 2026-10-10（第十七轮）—— 日志页按反馈修四处问题（读/写态、任意日期、日期自持、丢保存）

**用户反馈的四个问题 + 一个提问**

1. 需要能**手动填写任意日期**的日志，而且左栏那个**加号点了没反应**；
2. 右侧内容**状态管理有问题，一直处于编辑状态**；
3. **取消左上角全局日历的点击跳转**；
4. 想知道日志编辑器用的是什么工具。

**逐条定位（先读代码，不猜）**

| 现象 | 根因 |
|---|---|
| 加号无反应 | `pickDate(today)` 在 `d === date` 时 **early return** —— 本来就停在今天就等于什么都不做；且**根本没有选任意日期的入口** |
| 一直处于编辑状态 | 设计如此：`RichTextEditor` 无条件常驻，没有读态 |
| 日历带动日志页 | 日志页的日期来自 App 的全局 `date`，而 `pickDate` 又反向 `onDateChange` 推回全局 |
| （自查发现的）**丢保存** | 卸载清理 `useEffect(..., [])` 闭包留住的是**首次渲染**的 `flush`，那时 `day===null` → `flush` 立刻 return false，**「切页签时保存」从未生效** |
| （自查发现的）切日期用旧内容挂载 | `date` 变化的那一次渲染里 `docLoading` 还是 false 且 `day` 还是旧一天，于是按新日期作 key 的编辑器**拿旧内容挂载** |

**改法**

- **读/写态分离**：默认读态（`RichView` 渲染，**完全不挂载编辑器**），点「编辑」/「开始写」进写态，
  按「完成」退出；进写态按钮文案变「完成」，关联任务胶囊此时才可删。
- **日期自持**：`activeDate` 由本页管理，**不再跟随全局日历**；外部跳转走 `jumpTo={{date,nonce}}`
  （只在 nonce 变化时生效），目前唯一使用者是「搜索命中日志」。
- **任意日期**：头部加 `DatePicker`（复用既有基元），可以挑一个从没写过的日期直接开写；
  那种日期右栏显示空白页 +「写这一天」。
- **加号**：改为「写今天」——切到今天并**直接进写态**，保证任何情况下点击都有反馈。
- **`canEdit = 写态 && loadedDate === activeDate && day`**：彻底杜绝用旧内容挂载编辑器。
- **`flushRef`**：cleanup 里一律调用 `flushRef.current()`，修掉切页签丢最后几秒输入的静默 bug。

**又一次「夹具说谎」，两处，都值得记住**

1. 用 `includes('编辑')` 去点右侧「编辑」按钮，**先命中了左栏天列表里预览含「编辑器」的那一天**，
   夹具点错目标、还把当天切走了 —— 现象看起来完全是产品 bug。已改为**先精确匹配**再退回 `includes`。
2. 改完后再截，**DOM 明摆着是写态**（截图紧前刚查：14 个工具按钮、按钮文案=完成），
   **但 PNG 还是上一张读态画面** —— 隐藏窗口给了**过期的合成帧**。
   修法：capture 前 `invalidate()` + 一次 1px 尺寸抖动强制重绘；并在 capture 前再打一份
   `截图前状态`，好把「状态没变」与「画面过期」区分开。

**验证（三态都截了图并逐项自检）**

| 状态 | 自检结果 |
|---|---|
| 读态 | `editorPresent:false`、`toolbarButtons:0`、`richViewPresent:true`、按钮=「编辑」 |
| 写态 | `editorPresent:true`、`toolbarButtons:14`、按钮=「完成」、`editorBorder:0px`、`15.5px` |
| 空白日期 | `blankState:true`、按钮=「开始写」、`mountedChips:0` |

`typecheck` exit 0；`build` exit 0；`test:data` 112/112；三张截图均 `longRuns:0`（无黄框）。

**回答用户的提问**：日志编辑器用的是 **TipTap 3**（基于 ProseMirror 的无头富文本框架），
装配见 `components/RichTextEditor.tsx`：`StarterKit`（关闭内置 codeBlock）+ `Table/TableCell/TableHeader/TableRow`
+ `CodeBlockLowlight`（lowlight 语法高亮）+ `Highlight` + `TextStyle` + `Color` + `Image(allowBase64:false)`。
它与会议纪要**共用同一个组件**。

---

## 2026-10-10（第十六轮）—— 用画面验证「纸张化没有污染共用编辑器」+ 修掉截图夹具的动画坑

**本轮做的是"验证我上一轮声称过、但从未验证过的事"**

上一轮我把日志页纸张化样式全部写在 `.journal-doc` 作用域下，并**声称**不会影响会议纪要 ——
但那是推断，不是验证。本轮用刚造出来的 `ui:shot` 把它验掉了。

扩展夹具：
- 支持**切页后再点一个按钮**（`npm run ui:shot -- 会议 out/x.png 新建会议`），
  这样才能打开弹窗里的编辑器；
- `ui-shot.json` 新增 **`sharedEditor`** 自检：找出**不在 `.journal-doc` 里**的 `.editor-wrapper`，
  报出边框/圆角/字号 —— 专门用来抓「共用组件被污染」。

**结果（约束成立，已可视化确认）**

| | 日志页编辑器 | 会议编辑器（同一个 RichTextEditor） |
|---|---|---|
| 边框 | **0px** | **≈1px**（盒子保留） |
| 圆角 | 0 | 8px |
| 正文字号 | 15.5px | **14px**（未污染） |
| min-height | 52vh | 300px |

会议纪要弹窗截图（`out/ui-meeting-editor.png`）肉眼确认完好：标题/标签/日期、14 个工具按钮、
附件条（图片/文件 + "支持粘贴/拖拽图片"）、取消/保存，全部正常。

**顺带修掉夹具一个会让截图"说谎"的坑**

第一次截会议编辑器时，日志显示 `再点击包含「新建会议」的按钮: clicked`、
DOM 自检也报 `inDialog: true`，**但截图里根本没有弹窗**。原因是：
窗口是 `show:false` 的，Chromium **不推进动画时钟**，而 `.wl-modal` 的入场动画
`wl-pop-in` 的 keyframes `from { opacity: 0 }` —— 元素就**永远停在第一帧**。

修法：截图前用 `insertCSS` 注入 `animation:none; transition:none`，让元素回到自身基础样式。
**这条对任何 headless 截图都适用**，已写进 [06](06-conventions.md) §6。
（教训：截图工具的"看不到"和产品的"不显示"长得很像，必须先排除夹具自身的问题。）

**验证**：`typecheck` exit 0；`build` exit 0；`test:data` 112/112；
`ui:shot` 日志页与会议弹窗两处均跑通，`longRuns` 全为 0。

**黄框**：至此本应用侧能查的全部查完（CSS 探针 + 真画面像素 + 会议弹窗像素），
**三处证据都指向"不是本应用画的"**。剩下的一步必须由用户在真机上做（详见 [05](05-progress.md) §7）。

---

## 2026-10-10（第十五轮）—— 造出「能看到画面」的能力；用像素证据排除黄框

**本轮解决的问题其实是我自己的盲区**

前面所有界面改动都只过 `typecheck` / `build` / 数据层测试 —— **从没人看过画面**，
连我自己也没看过。这正是"图片一直显示不出来却长期没人发现"这类事故的根源。

于是做了 **`npm run ui:shot`**：

1. 用 mock `window.api`（`scripts/ui-mock-api.cjs`，62 个方法）把**渲染层独立跑起来**；
2. 用本地 HTTP 托管 `out/renderer`（`file://` 下 ES module 会被 CORS 拦，必须走 http）；
3. `capturePage()` 截图 + 输出**页面结构自检**（关键元素的尺寸/字号/边框）与控制台日志；
4. **黄像素分析**。

两个坑写进了脚本与文档：夹具必须**先清 `ELECTRON_RUN_AS_NODE`**（否则 electron 退化成纯 Node）；
判定"黄框"要看 `longRuns` 而不是 `yellowRatio`（下详）。

**第一次真的看到了日志页**（`out/ui-shot.png`）：左栏天列表 + 右栏纸张的观感成立 ——
纸宽 780、编辑器外框 **0px**（灰盒子确实没了）、正文字号 15.5px / 行高 30.2px、
工具条 14 个按钮、关联任务 2 个胶囊、排版（标题/段落/列表/表格/引用）都正常。

**黄框：像素级证据排除了本应用**

- 第一轮 CSS 探针：`CSS.supports('caret-line-highlight','none') === false`（原有那条 CSS 是空操作）、
  编辑态元素 outline/border/box-shadow **无黄色**、`main.css` 黄色系规则 **0 条**。
- 第二轮**真画面**：整图 2139×1257 逐像素分析 → **`longRuns: 0`，最长黄段仅 2px**。
- 一开始 `yellowRatio` 报 0.3%「黄像素」，看着像有问题；**裁剪放大后确认那只是搜索框占位文字的
  ClearType 亚像素抗锯齿边缘**（橙/蓝彩边）。这是个重要的方法论教训：**不能用"偏黄像素比例"判断黄框**。

**结论：黄框不是本应用画出来的**（至少不在日志页与编辑器内容区）。最可能是
**Windows 的「文本光标指示器」**（设置 → 辅助功能 → 文本光标；默认色偏黄橙，画在光标处，任何程序都有）。
已请用户做 10 秒判别：在记事本 / 浏览器地址栏打字是否也有。
**已明确记入文档：不要再在没有新证据的情况下"修"它。**

**验证**：`typecheck` exit 0；`build` exit 0；`test:data` 112/112；
`npm run ui:shot` 端到端跑通并产出截图与自检。

**遗留**：日历「有日志」打点未做；待用户在真机确认黄框归属与新界面的观感。

---

## 2026-10-10（第十四轮）—— 日志界面按反馈重塑：一天一篇 + 左栏天列表 + Word 式纸张

**用户反馈**：布局不对（要左栏按天列表 + 右栏当天日志）、编辑体验不像 Word、内容区有黄框、
参考苹果系统同类记录软件的观感。

**提问确认的三条决策**

| 项 | 结论 |
|---|---|
| 文档模型 | **一天一篇连续文档**（放弃「一天多条带时间」—— 卡片式分条与 Word 式连贯感本质冲突） |
| 左栏天列表 | **只列写过的天**，倒序 + 内容预览，滚动加载更早 |
| 工具栏 | **顶部常驻一条轻量低对比工具条** |

**数据模型改动（含兼容）**

`{ date, entries: [...] }` → `{ date, body, attachments, mountedTasks, createdAt, updatedAt }`

**向后兼容读取**：仍能读旧 `entries[]`，按时间顺序合并成一整篇；多条时每条前加时间小标题，
**单条时不加**（避免凭空多出时间行）；附件/关联任务合并（按 taskId 去重）；
`createdAt` 取最早、`updatedAt` 取最晚。**只在读取时转换、绝不回写**，原始数据始终还在。

> **意外收获**：在真实数据副本上验证时发现 `logs/journal/2026/2026-10-10.json` **真的存在** ——
> 用户之前打开界面时写过一条（`{"time":"17:40","body":"<p>日志1</p>"}`）。
> 也就是说兼容路径不是假想的，而是马上就被真实数据用上了，且验证通过（预览显示「日志1」，无多余时间行）。

**界面与体验**

- 左栏：天列表（倒序、预览、`before` 分页、关联任务小标记），点某天切换右栏并同步全局日期
- 右栏：**居中定宽 780px 的纸**（轻阴影）+ 日期标题 + 保存状态 + 操作区
- **去掉灰边框盒子**：纸张化样式全部写在 **`.journal-doc` 作用域**下覆盖，
  **不改共用 `RichTextEditor` 的全局规则**（否则会连带改掉会议纪要的观感）
- 工具条改为贴顶低对比细条（sticky）；正文 15.5px / 行距 1.95
- **自动保存**：停止输入 700ms 落盘；切换日期与组件卸载（视图是条件渲染会被卸载）时也 flush；
  头部显示「保存中… / 已自动保存」。这是「像 Word 一样不用点保存」的核心体验改动

**黄框：仍未确诊（如实记录）**

用 Electron 探针（真实 `main.css` + 与 app 相同的编辑器 DOM + 聚焦后 dump 计算样式）实测：
`CSS.supports('caret-line-highlight','none') === false`（项目原有那条 CSS 是**空操作**）、
编辑态元素的 outline/border/box-shadow **无任何黄色**、`main.css` 里黄色系规则 **0 条**、
用户 Windows 强调色是**蓝色**、App 强调色是 violet、数据里无 `<mark>`。
两个"默认焦点环"假设都被自己的实测推翻，因此**没有硬改**，改为索取截图 +
判别性测试（其他程序里是否也有 → 若为则是 Windows 文本光标指示器，与本应用无关）。

**验证**

- `typecheck` exit 0；`build` exit 0；`test:data` **112/112**（重写日志数据层断言：旧格式合并、
  单条不加时间行、覆盖式保存且保留 createdAt、整天为空删文件、摘要倒序/预览/分页/跳过空白、
  兼容性断言、并发保存无半截文件）
- **真实数据副本 8/8 PASS**：任务日期扫描一致、每天任务内容**逐字节一致**、日志读回、
  关联任务快照、旧格式合并、旧格式不回写、左栏摘要、用户真实旧格式内容保留

**教训（本轮又踩一次）**：改测试文件里的重复变量名时用了 PowerShell 文本管道，把文件压成一行。
本次改用 `[IO.File]::ReadAllText` + 字符串 `Substring` 拼接（保留编码与换行）来做大段替换，
并在写回后立刻 `node --check` + 跑测试确认 —— 这类手术必须"改完即验"。

**遗留**：日历「有日志」打点未做；**所有界面改动仍未被人在真实界面里看过**。

---

## 2026-10-10（第十三轮）—— 日志界面反馈：布局与写作体验重塑（开工）+ 黄框诊断

**用户反馈（原话要点）**

1. 日志界面的布局不对：应该是**左侧一栏按天显示的可滚动列表**，**右侧显示当天写的日志**。
2. 编辑体验不对：要**像 Word 那样的视觉与打字体验**。
3. **编辑器内容区老是有黄框**，严重影响体验。
4. 参考苹果系统里同类记录软件的观感。

**本轮确认的决策（提问后用户选定）**

| 项 | 结论 |
|---|---|
| 文档模型 | **改成一天一篇连续文档**（放弃原先的「一天多条带时间」）—— 多条目卡片与 Word 式连贯感本质冲突 |
| 左栏天列表 | **只列有日志的天**，倒序 + 内容预览，滚动加载更早 |
| 工具栏 | **顶部常驻一条轻量低对比工具条** |

> 现在改数据模型**成本最低**：日志目前**没有任何真实用户数据**（只有测试造的临时数据）。
> 已计划做**向后兼容读取**：旧的 `{entries:[]}` 自动合并成一页，不丢内容。

**黄框诊断：测了，但没测出来（如实记录）**

写了一个 Electron 探针（载入真实 `main.css` + 构造与 app 相同的编辑器 DOM + 聚焦后 dump 计算样式）：

| 检查 | 结果 |
|---|---|
| `CSS.supports('caret-line-highlight','none')` | **false** → 项目里那条「关闭黄框」的 CSS **是彻底的空操作**，浏览器解析时直接丢弃（按 `cssText` 遍历都扫不到它） |
| 编辑态 `.ProseMirror` 的 outline / border / box-shadow | **无任何黄色**，`outlineStyle: none` |
| `main.css` 里带黄色系色值的规则 | **0 条** |
| 用户 Windows 强调色（Chromium 默认焦点环跟随它） | `#0078D4` = **蓝色**，所以默认焦点环不可能是黄的 |
| 用户 App 强调色 | **violet**（不是 amber），所以也不是我加的 `--accent-ring` 边框 |
| 数据里的 `<mark>` | **无** |

**结论：黄框成因仍未确诊。** 我给出的两个"默认焦点环"假设都被自己的实测推翻了，所以**没有硬改**，
改为向用户要截图 + 一个**判别性测试**（在记事本/浏览器地址栏里打字是否也有黄框 —— 若有，则是 Windows 的
「文本光标指示器」等系统级无障碍特性，与本应用无关）。

**本轮实际改掉的（有据可依的两处）**

1. **删掉无效的 `caret-line-highlight: none`**，并在 CSS 里写明它为何无效（防止后人再加回来）。
2. **补上编辑面缺失的 `outline: none`**：原先所有 `outline:none` 都只写在只读视图 `.rich-content` 上，
   而真正可聚焦的是 `.rich-editor-content > .ProseMirror`（TipTap 建在里面的子节点），它一直没有对应规则。
   聚焦提示改为由外层 `.editor-wrapper:focus-within` 的边框表达（更克制）。
3. **补 `mark` 样式**：`main.css` 里原本完全没有 `mark`，所以点工具栏「高亮」得到的是浏览器默认的纯 `#ffff00`。
   新增 `--highlight` 变量（`color-mix` 低饱和琥珀），覆盖默认黄底。

**验证**：`typecheck` exit 0；`build` exit 0；`test:data` 109/109 通过。

**未开始**：布局重塑与数据模型改造（本轮先做了诊断与 CSS 修复，避免在未确诊前动大结构）。

---

## 2026-10-10（第十二轮）—— Phase 1e（搜索 + 回收站）与 Phase 1f（迁移方案设计）

**Phase 1e：日志纳入全局搜索与回收站（`18d38d7`）**

搜索：
- 新增 `search.searchJournal`（条目正文 HTML 纯文本化后检索 + 匹配挂载任务标题）与
  `search.searchAll`（任务 + 日志合并、日期倒序、统一截断 50 条，沿用"最新优先 + 满额即停"策略）
- `SearchHit` 扩展 `kind?: 'task' | 'journal'` 与 `entryId?`，**向后兼容**（`taskId` 保留，`search:tasks` 通道保留）
- 新增 `search:all` 通道（IPC / preload / index.d.ts 三处同步）
- `SearchBox` 改用 `searchAll`，结果行标注「任务 / 日志」来源，按 kind 分派跳转
- **顺手修掉一个既有隐患**：命中项 React key 原先只用 `taskId`，而**区间共享任务同一 id 会命中多天** → key 重复

回收站：
- `TrashItem` 增加可选 `journal` 字段；日志类显式写 `tasks: []`（不是 undefined），避免调用方直接 `.map` 抛错
- **把恢复编排从 IPC 层下沉为 `trash.restoreTrashItem`** —— 既与 `snapshotTaskToTrash` 对称，
  也让「快照 → 删除 → 恢复」闭环**首次能被 test:data 覆盖**；同时按 kind 分支并兜底 tasks 缺失
  （正好修掉审计发现的 P4-2）
- `journal:deleteEntry` 改为**先快照进回收站、再删除**；`TrashView` 按 kind 展示，并补上**失败反馈**
  （原先恢复/永久删除只在成功时提示，失败时「点了没反应」）

**Phase 1f：迁移方案设计，并实测解除了它的前置依赖**

设计了「加 `bodyHtml?`、`body`(markdown) **永不改写**」的**懒迁移**方案（只在用户首次用富文本
编辑某任务时才转换，不搞批量搬迁）。

关键前提是「旧版本会不会抹掉它不认识的字段」，我直接读代码确认了：**会保留**。
`readTasks` 用 `{ ...t, … }` 展开原对象只补默认值；`updateTask` 在展开对象上原地改字段，
写回又是 `{ ...task, order }`。**因此 1.5.4 不会抹掉 `bodyHtml`，新旧版本可安全交替读写同一份数据。**

**本轮犯的一个错（已修复，值得记）**

为改一个重复变量名，我用 PowerShell `Get-Content | -replace | Set-Content -NoNewline` 去改
`scripts/test-datalayer.cjs` —— 结果**把整个文件压成了一行**（612 行 → 1 行），
所有 `//` 注释把后续代码全部注释掉，`node --check` 直接语法错误。
**恢复方式**：`git checkout --` 回到上一个提交（结构完好、91 项测试全过），再用 `edit` 工具重做那两处新增。
**教训：永远不要用 PowerShell 文本管道改源码文件** —— 用 `edit` 工具做字面替换。

**验证**：`typecheck` exit 0；`build` exit 0；`test:data` **105/105** 通过（91 → +14）。

**遗留**：日历「有日志」打点（Phase 1e 唯一未做项）；界面仍**从未人工点过**。

---

## 2026-10-10（第十一轮）—— 日志模块 Phase 1b/1c/1d：共享编辑器 + 页面 + 挂载任务

**Phase 1b：抽出共享 `RichTextEditor`（`034869b`）**

日志需要与会议纪要一模一样的富文本能力。若再写一份 TipTap 配置就会出现**第三份**会各自漂移的实现
（项目此前已踩过「两份日期实现靠注释保持一致」的坑），因此先抽共享组件：

- 新增 `components/RichTextEditor.tsx`：TipTap 装配 + 工具栏 + 附件区
  （粘贴/拖拽图片、选文件、打开/删除附件、并同步从正文移除引用）
- `MeetingEditor.tsx` 从 340 行缩到 111 行，只留会议特有外壳（标题/标签/日期/保存）
- **类名与 DOM 顺序完全不变**，`main.css` 一行未改
- 图片改走通用通道 `saveAttachmentImage(attachFolder, …)`，folder 由调用方决定
  （会议传 `meetings/<id>`，日志传 `journal/<日期>`），日志因此不需要新增专用 IPC

**自查出并修掉一个自己引入的真实回归**：改造成 props 回调后，
`uploadImages` 里的 `onAttachmentsChange([...attachments, 新项])` 会在一次多文件上传时
用同一份旧快照互相覆盖 → **「一次拖 3 张图只剩最后 1 张」**。
已改为先在本地累积、循环结束后一次性回传并加注释。
（教训：函数式 setState 换成普通回调时，闭包快照语义会变。）

**Phase 1c/1d：日志页面 + 挂载任务（`6306426`）**

- `JournalView`：默认按天（跟随日历）、可切连续时间线（`before` 分页「加载更早」）、
  新建/行内编辑/删除、时间可改、空内容拒绝保存（TipTap 的 `<p></p>` 视为空）、
  切换日期丢弃草稿以免写错日期、读态走 `RichView kind="html"`（内部已净化）
- 挂载任务：当天任务多选 → 只存**快照**（taskId/date/title/done）→ 点击**先校验任务是否还在**，
  在则跳「任务」页并选中，已删除则提示而**文字保留**
- 导航按域重排：新增「日志」组；**「日报」改名「任务」**，与周报、任务发布同属「任务」组
  （周报/报表基于任务汇总，放进「日志」组会把两个域重新混在一起）

**懒加载验证**：构建产物为 `RichTextEditor` 1,328 kB（会议与日志**共享**一个 chunk）、
`MeetingEditor` 3.28 kB、`JournalView` 18.04 kB、主包 877 kB —— **主包不含 TipTap**，且无重复打包。

**真实数据兼容性验证（用户硬约束）**

写了一次性脚本，在**真实 `logs/` 的副本**（35 天数据）上加入日志后逐项对比，**6 项全 PASS**：
`listDatesWithTasks` 完全一致、每天 `readTasks` **逐字节一致**、日志读回正确、挂载快照正确、
日志日期清单正确、日志位于数据根内（备份/同步整包带走）。

> 第一次跑该脚本时报了 2 处 FAIL —— 排查后确认是**脚本自身**把第二个测试日期硬编码成了
> `2026-10-09`，恰好与真实数据的最后一天撞车，两次写入落到同一天。修正后全绿。
> **产品行为一直是对的**，但这提醒：验证脚本自身的错误同样会伪装成产品缺陷。

**验证**：`typecheck` exit 0；`build` exit 0；`test:data` 91/91 通过。

**遗留**：Phase 1e（搜索/回收站/日历打点）、Phase 1f（markdown→富文本迁移方案）。
**界面从未人工点过**（与 Phase 0 的图片修复一起待用户确认）。

---

## 2026-10-10（第十轮）—— 日志模块 Phase 1a（数据层）+ IPC 契约审计与修复

**Phase 1a：日志数据层（已完成，commit `e1b86c8`）**

按用户确认的方案实现日志数据层（本期只做数据层与 IPC，**界面下一步**）：

- `src/shared/types.ts`：`JournalEntry` / `JournalDay` / `MountedTask` / `JournalEntryInput`
- `src/main/paths.ts`：`journalRoot` / `journalYearDir` / `journalDayPath`
- `src/main/journal.ts`（新增）：存储 `logs/journal/<年>/<日期>.json`，一天一文件、一天可多条；
  全走 `jsonStore`（原子写 + 损坏隔离 + 全局写锁）；条目清空时**删文件不留空壳**；
  读入逐字段规范化；**日期强校验**（`date` 来自渲染层且参与拼接路径，阻断 `../..` 穿越）；
  时间线查询支持 `before` / `limit` 且跳过空天。
- IPC 三处同步：`journal:listDates` / `readDay` / `listRange` / `saveEntry` / `deleteEntry`，
  返回值一律**显式**（失败返回 `{ ok:false, entry:null, error }`，绝不返回 `undefined`）。

**兼容性（用户硬约束）—— 已确认并加了测试锁死**

- `tasks.listDatesWithTasks` 原先枚举根目录下**每个**子目录当年份再匹配 `<年>/YYYY-MM-DD.json`。
  `journal/<年>/<日期>.json` 因为**多一层**而侥幸不被误判 —— 但那是巧合。已**显式**加上
  「目录名必须是 4 位年份」的约束，并用 `test:data` §12.11 断言「日志日期不得污染任务日期扫描」。
- 1.5.4 只会按日期**构造**任务路径、不递归扫描目录，所以多出 `journal/` 对它完全无感；
  备份 / WebDAV 是整目录打包，日志自动被包含。

**IPC 契约全量审计（子代理，59 个通道）**

结论：**57 一致 / 1 高危 / 1 低危 / 0 无法静态判定**。修掉 2 处：

- **`meetings:delete`【高危】** —— 主进程 `return deleteMeeting(...)`（该函数是 `Promise<void>`，
  返回 `undefined`），而 preload 声明 `Promise<{ok:boolean}>`，渲染层 `MeetingList.tsx:152`
  第一行就读 `r.ok` → 异步回调里抛 `TypeError` 且无人捕获 →
  **表现为「会议删了但抽屉不关、列表不刷新、没有成功提示」**，与图片事故完全同型。
  改为显式 `return { ok: true }`（与相邻 `meetings:save` 同形）。
- **`update:install`【低危】** —— 实际返回带 `message` 的超集，3 处声明补上 `message?: string`。

**顺带修复：同步冲突检测失效**

`sync.lastDataMtime` 原先只扫「根文件 + 一层子目录」，于是 `journal/<年>/<日期>.json`（三层）与
`attachments/meetings/<id>/x.png`（四层）的修改**根本不会被发现** → 本地明明改了却不提示冲突，
可能在拉取时静默覆盖。改为**递归**（深度上限 4）。

**本轮新增的待办**（记入 [07](07-optimization-backlog.md) 的 P4 段，均未修）

1. `sticky:add` 缺 `Array.isArray` 守卫（全项目唯一漏掉的读改写）
2. `trash:restore` 假定条目含 `tasks` 数组（半损坏即让「恢复」无反应）
3. `settings:set` 失败静默（渲染层浮动 Promise 无 `.catch()`）
4. 共性放大器：**渲染层普遍缺少 IPC 失败的 `.catch()`** → 一律表现为「点了没反应」

**同时修正了两处过时文档**：`03-data-model.md` §8 仍写着「日期有两份并行实现」（1.5.4 已统一为单一实现）；
`07` 的进度抬头仍写「未发版」。

**验证**：`typecheck` exit 0；`build` exit 0；`test:data` **91/91** 通过（原 65，新增 26 项）。

**下一步**：Phase 1b —— 抽出共享 `RichTextEditor`（会议与日志共用，保持懒加载）。

---

## 2026-10-10（第九轮）—— 新迭代启动：日志模块 Phase 0（定位并修复图片显示缺陷）

**背景**：用户批准「日报拆分为日志 + 任务」的完整方案，本期**只做日志模块 + 修图片 bug**，任务侧不动、导出不做。
用户另提硬约束：**新写入的数据必须让 1.5.4 仍能读，且未来任务正文改富文本时要能从 1.5.4 的 markdown 无损迁移。**

**Phase 0：图片显示缺陷 —— 已定位并修复**

排查过程（**先测不猜**）：

1. 写了隐藏窗口的 Electron 探针，实测 `wlattach://` 在 4 种组合下的图片加载
   （file:// 与 http:// 页面 × `net.fetch(pathToFileURL)` 与 `fs.readFile+Response` 两种处理器）：
   **全部成功**（`imgLoaded: true`、`naturalWidth: 567`），路径解析与权限也对。
   → **推翻了我原先"协议注册被跳过 / net.fetch(file://) 失败"的两个假设**，CSP 也已允许 `wlattach:`。
2. 转而核对数据链路，发现真相：`attach:saveImage` 的处理器返回 `saveAttachmentBuffer(...)` 即**对象**
   `{ url, file }`，而 preload 声明 `Promise<string>`，两个调用点都按字符串用：
   - `MarkdownEditor.tsx:62` → `![](${url})` → 写成 `![]( [object Object] )`
   - `MeetingEditor.tsx:96` → `<img src="${url}">` → `src="[object Object]"`，浏览器显示**破图 + alt 文件名**
   （**这正是用户描述的"图片图标占位符 + 图片名"**）
3. 因此**日报正文与会议纪要的图片从来就没能显示过**，而且不报错不崩溃，所以一直没被发现。
   TypeScript 拦不住是因为 `ipcRenderer.invoke` 返回 `any`，preload 的类型声明只是未校验的断言。

修复：

- 主进程 `attach:saveImage` 改为只返回 url 字符串（附注释说明为何不能返回对象）
- 新增 `src/shared/attachmentUrl.ts` 的 `normalizeAttachmentUrl`，在 preload 接入作为第二道防线
- `test:data` 新增 11 项附件链路断言（含"对象直接插值会产生 `[object Object]`"这条回归断言、恶意 folder 净化）

**顺带排除的环境陷阱（值得记住）**

- 本 agent 的环境里 **`ELECTRON_RUN_AS_NODE=1` 是被继承的**，直接跑 `electron.exe` 会退化成纯 Node
  （`require('electron')` 返回二进制路径字符串，`app`/`protocol` 全 undefined）。任何 Electron 探针/脚本
  **必须先清除该变量**。真实应用走 `scripts/electron-vite.cjs` 会自动清掉。
- Electron 在 Windows 上是 **GUI 子系统程序，`console.log` 不会出现在父终端** ——
  探针必须把结果**写文件**再由外部读取（这是我第一次跑探针"无输出"的原因）。

**验证**：`typecheck` exit 0；`build` exit 0；`test:data` **65/65**（从 54 增加）。
**待用户实机确认**：装/跑 1.5.4 之后的版本，在会议纪要里贴一张图，确认图片**直接可见**。

**遗留**：Phase 1（日志模块）尚未开始。另已派子代理审计**是否还有同类 IPC 形状不符的隐患**。

---

## 2026-10-10（第八轮）—— 评估「登录注册 + 数据库」，结论：不做

**做了什么**

用户提出为软件加登录注册（账号绑定邮箱），考虑用 MySQL，并要求先看环境是否支持、还需要准备什么。
做了一次环境排查，并就架构给出分析与选项；用户最终决定**取消该功能**。

**环境事实（已记入 [01-project-brief.md](01-project-brief.md)）**

- **MySQL 8.0.45 Community Server 已安装且正在运行**（服务 `MySQL80`，端口 3306/33060，InnoDB，root 已设密码）；
  CLI 在 `C:\Program Files\MySQL\MySQL Server 8.0\bin\`（未加入 PATH）；无图形客户端。
- Node v24.14.0 / npm 11.9.0 / git 2.50.1；Docker 未装、WSL 无发行版。
- MySQL 监听 `::`（所有网卡）但无防火墙入站规则 → 局域网实际连不上（安全）；建议顺手 `bind-address=127.0.0.1`。

**结论与决定**

- **概念纠偏**：用户说「需要在别的电脑上使用，但不买服务器」—— 这是**多设备**需求，不是**多用户**需求。
  而**跨设备同步软件已经有了**（WebDAV），注册个坚果云即可，零开发零成本。
  用户据此决定取消登录功能。**本轮没有产生任何代码改动**（工作区干净、版本仍 1.5.4）。
- **记下了一条不能碰的红线**（写进 01-project-brief，防止将来重新论证）：
  **Electron 客户端绝不直连 MySQL** —— 凭据必须打包进 asar，而 asar 是明文归档（本项目已实测可被
  `@electron/asar` 直接读出）。数据库只能待在后端 API 后面。
- **不买服务器也能做账号**的路径也已记下：本机当服务端 + Tailscale 个人版组网
  （[官网](https://tailscale.com/pricing)：免费、无限设备、最多 6 用户），无需公网 IP / 域名 / 备案。
  将来若真要给他人用，后端沿用 Node + Fastify + Prisma + 本机 MySQL 即可。
- **未做**：没有装 Workbench/DBeaver，没有把 mysql 加进 PATH，没有修改 my.ini（这些都是可选改善项，等真有需要再说）。

**验证**：`git status` 干净；`package.json` 仍为 1.5.4；`scripts/` 无临时脚本残留。

---

## 2026-10-10（第七轮）—— 补推 GitHub（Steam++ 加速器启用后）

**做了什么**

用户再次要求推送 GitHub。重新检测网络时发现 `github.com` 已解析到 **127.0.0.1** —— 查得
**Steam++ / Watt Toolkit 加速器**正在运行（hosts 把全部 github 域名指向本机，`Steam++.Accelerator`
监听 `0.0.0.0:443` 做反向代理；git 已配置 `http.sslBackend = schannel`，因此能信任其证书）。

于是补推成功：

- `git push github master` → `c147397..a884a87` ✅
- `git push github refs/tags/v1.5.4 --force` → `c147397...a654035` ✅（纠正了发行版自动建在 1.5.3 提交上的错位 tag）
- 复核：**Gitee 与 GitHub 完全一致** —— `master = a884a87`、`v1.5.4 = 17076a7`

**结论与决定**

- 上一轮"GitHub 被网络阻断"的判断**只在加速器未启动时成立**。正确表述应为：
  **`api.github.com` / `uploads.github.com` 无需加速器即可达（所以能发布）；`github.com` 需加速器才能 push。**
- **加速器对大文件下载不稳定**：为校验 GitHub 附件的 sha512，93MB 安装包反复中断
  （`curl: (56) Recv failure: Connection was reset`、`end of response with … bytes missing`），
  最终放弃该步。**判断：不值得为它反复重试** —— GitHub asset 的登记 size（97,209,993）与其 yml 声明一致，
  且主源 Gitee 已逐字节验证通过。已在 [05-progress.md](05-progress.md) §6 记为"未验证项 + 换通道的做法"。
- **副产品结论**：应用内「GitHub 镜像源」在本机下载更新大概率会失败（同一个加速器瓶颈）；
  `updateSource: auto` 优先 Gitee，不影响正常更新。

---

## 2026-10-10（第六轮）—— 发布 1.5.4（Gitee 完成 / GitHub 受网络阻断）

**做了什么**

1. 升版本 `1.5.3 → 1.5.4`；写 `CHANGELOG.md` 1.5.4 章节 + `releaseNotes.ts` 条目；提交 `17076a7`（80 文件、+6202/−1822）。
   发版前用**与发布脚本完全相同的 .NET 正则**预检了 CHANGELOG 备注提取（1179 字符，匹配成功），避免发布说明退回默认文案。
2. 发布到 Gitee 与 GitHub（各含 build + electron-builder 打包 + API 上传）。
3. 打附注标签 `v1.5.4`，推送 master 与 tag。
4. 对两端发布产物做了 sha512 完整性核对。

**结果**

| 平台 | 发行版 | git 推送 | 完整性 |
|---|---|---|---|
| Gitee | ✅ | ✅ master + tag = `17076a7` | ✅ 实测安装包 sha512 与 latest.yml **完全一致** |
| GitHub | ✅ | ❌ 网络阻断 | ⚠️ 仅确认 size 自洽，sha512 无法验证 |

**结论与决定（三个值得记住的运维事实）**

- **Gitee 的 1GB 是「累计附件配额」而不是单文件 100MB 限制。** 首次上传报
  `文件大小已超出仓库附件配额：1 GB` —— 仓库已有 11 个 ~95MB 安装包，用了 966 MB，只剩 57.7 MB。
  经用户决定删除 3 个 beta 版（v1.2.0-beta / v1.4.0-beta / v1.4.1-beta）释放 296.9 MB 后才发成功。
  **删旧发行版不影响自动更新**（更新只读 `releases/latest`），只是失去手动下载旧版的能力。
- **发行版会抢先建 tag。** 平台在创建发行版时自动在「当前远端 HEAD」建了 `v1.5.4`，而当时我还没 push 代码，
  所以 Gitee/GitHub 上的 tag 都指向了 **c147397（1.5.3 提交）**。已用
  `git push origin refs/tags/v1.5.4 --force` 把 Gitee 的纠正到 `17076a7`；GitHub 的等网络恢复后一并纠正。
  **正确顺序应是：先 push 代码 → 再 publish → 最后 push tag。**
- **本机网络下 GitHub 只能「发布」不能「推送/下载」**：`api.github.com` 与 `uploads.github.com` 可达（所以
  92.7MB 附件上传成功），但 `github.com:443` 与 `objects.githubusercontent.com` 不可达 → `git push` 失败、
  附件也无法下载回来校验。这也意味着**应用内的「GitHub 镜像源」在本网络下不可用**（`updateSource: auto` 优先 Gitee，不影响正常更新）。
- **两端安装包字节不同是正常的**：每次 publish 都会重新构建，两次构建的安装包 sha512 必然不同。
  验证必须「各平台的 yml 校验各平台的安装包」，不能拿本地 `dist/` 去比对另一端（我一开始就误判成"不一致"，
  后来才想清楚）。已把这条写进 [06-conventions.md](06-conventions.md) §7 的「发版前必查」。

**验证**：Gitee 安装包（97,210,032 字节）实测 sha512 与 latest.yml 声明**逐字节一致**；`npm run size` 通过（92.71 MiB）；
工作树干净，HEAD 与本地 tag 均为 `17076a7`。

**遗留**：GitHub 的 `master` 与 `v1.5.4` tag 待补推（命令已写在 [05-progress.md](05-progress.md) §6）。
仍未在本机安装运行过 1.5.4。

---

## 2026-10-10（第五轮）—— 收尾：P2-5 安全子集 + 全量验证

**做了什么**

1. **P2-5（安全子集）**：用一次性 codemod 把 `main.css` 里 **20 个以「轮次/版本号」命名的分区标题**改成领域描述名
   （`v3.1：弹窗/抽屉` → `弹窗 / 抽屉（Overlay 基元）`、`第三轮打磨` → `交互细节打磨` 等），统一装饰符长度，
   并在文件顶部加了**分区索引注释**（分区清单 + 样式约定）。**只改注释文字、未移动任何规则** → 层叠覆盖关系与视觉结果完全不变。
2. 全量验证：`typecheck` / `build` / `test:data`（54 项）/ 记忆库链接检查。

**结论与决定**

- **刻意没有做 P2-5 的物理重排**（把轮次分区的规则搬进领域分区）。理由有两条，都不是"没时间"：
  1. P2-5 条目**自身的验证要求**是「浅色/深色 × 6 强调色逐页目视对比」，当前环境没有视觉回归手段；
     该条目也明确写了「务必等 P0/P1 完成、且有稳定目视回归手段后再做，可先只做『加分区索引注释 + 修悬空变量』」——
     我执行的正是这个被授权的子集。
  2. 移动规则会改变层叠覆盖顺序，而这 20 个分区**本来就是"后写覆盖先写"的补丁链**，收益是纯整洁性、风险是真实视觉回归。
- **硬编码色值替换也刻意没做**，因为实测它**不可机械化**：89 行硬编码色值里只有 32 处与变量同值，
  其中 **23 处是 `color:#fff`**（强调色按钮上的白字）—— 换成 `var(--panel)` 在深色模式下会变成不可见；
  `#10b981` 等还可能本身就是强调色预设。这类替换必须逐个判断 + 目视确认。
- 这一判断已写进 backlog 的 P2-5 条目（「⛔ 刻意未做」），避免后续会话把它当成"遗漏"而贸然动手。

**验证**：`npm run typecheck` exit 0；`npm run build` exit 0（CSS 108.09 kB）；`npm run test:data` **54/54** 通过；
记忆库 12 个文件断链 **0** 处；`AGENTS.md` 8.8KB（预算 13.7%）；`main.css` 已无任何 `v3.x` / `第N轮` 分区名。

**遗留**：仅 P2-5 的物理重排 + 色值替换（需视觉回归能力）。**仍未启动过应用做人工点检** —— 这是唯一的验证缺口，
清单见 [05-progress.md](05-progress.md) §5「尚未验证的部分」。

---

## 2026-10-10（第四轮）—— 优化阶段第三批：P2-3 / P2-4 / P2-6 / P3-1 / P3-9

**做了什么**

1. **P2-3 拆分 `TaskPublish`**：改为 `components/TaskPublish/` 目录 —— `TaskPublishView.tsx`（主组件 + 两个抽屉，443 行）、`PendingTaskCard.tsx`、`PublishedList.tsx`、`types.ts`。`App.tsx` 懒加载改指向 `TaskPublishView`，chunk 名从含糊的 `index-*.js` 变为 `TaskPublishView-*.js`。
2. **P2-4 `index.ts` 瘦身**（795 → 650 行）：抽出 `saveWithDialog`（消除 5 处逐字重复的「SaveDialog + writeFile + try/catch」）；把「回收站条目如何组装」从 IPC 层下沉到 `trash.ts`（`snapshotTaskToTrash` / `snapshotPublishRecordToTrash`），原先这段逻辑只存在于 IPC 层、无法复用也无法单测。
3. **P2-6 日期工具去重**：新增 `src/shared/date.ts` 作为唯一实现，`src/main/storage.ts` 与 `renderer/utils/date.ts` 都改为 re-export（渲染层保留 `weekdayOf`/`weekInfoOf` 旧名别名，避免改动大量调用点）。
4. **P3-1 HTML 净化**：新增 `renderer/utils/sanitize.ts`（默认拒绝的允许列表），接入 `renderMarkdown` 出口；`RichView` 新增 `kind="html"`，`MeetingDetail` 改用它（不再自己 `dangerouslySetInnerHTML`）。
5. **P3-9 可访问性**：`DropdownSelect` 补键盘导航、导航项 `aria-current`、页签 `role="tab"`、色块 `aria-label`，并用 codemod 给**全部 66 个带 `title` 的按钮**补 `aria-label`。

**结论与决定**

- **测试从 18 项扩到 54 项**，这轮新增的三组断言都抓的是"最难人工验证、最容易静默回归"的东西：
  - **日期 12 项**：W01 跨年边界、2020-W53、`weekKeyToDates ↔ getWeekInfo` 往返、非法 key、跨月枚举 —— 合并两份实现后必须有回归保护；
  - **回收站 10 项**：快照收集跨天全部副本 → 删除 → `findTrashItem`（确认不移除）→ 恢复 → **重复恢复不产生同 id 重复项** → 索引仍正确 → 移出；
  - **净化 14 项**：script 子树删除、`javascript:`、**换行混淆的 `java\nscript:`**、`style` 里的 `url()` 与 `position:fixed`，以及保留合法 `style` 颜色 / `data-math` / https 外链 / 表格 / `wlattach://`。
- **净化刻意不用 DOMPurify**：安装包只剩约 2.8MB 余量，改为自实现默认拒绝允许列表；已在代码注释里写明"若将来需要更自由的富文本应换回 DOMPurify 并重新评估体积"，避免这个取舍被遗忘。
- **`MeetingDetail` 不能直接走 markdown-it**：会议正文是 TipTap 产出的 HTML，喂给 markdown-it 会因缩进被判成代码块而破坏排版 —— 因此给 `RichView` 加了 `kind="html"` 模式（只净化不解析），而不是简单复用它。
- **aria-label codemod 踩了一个坑**：第一版正则 `[^>]*?` 被 `onClick={() => ...}` 里的 `>` 截断，只改到 27/64 处；把 `=>` 换成占位符再匹配后补齐到 66/66。这也说明**正则改 JSX 必须校验覆盖数**，不能改完就信。

**验证**：`typecheck` exit 0；`build` exit 0；`test:data` **54/54** 通过；`grep` 确认带 `title` 的按钮中仍缺 `aria-label` 的为 **0**。

**遗留**：仅剩 **P2-5**（`main.css` 轮次分区收敛）。该项风险高收益低，计划只做「分区重命名 + 顶部索引注释 + 消除硬编码色值」，**不移动规则顺序**（移动会改变层叠覆盖 → 视觉回归），需浅色/深色 × 6 强调色逐页目视回归，放下一步。仍未启动过应用做人工点检。

---

## 2026-10-10（第三轮）—— 优化阶段第二批：P1 收尾 + P2-1 / P2-2

**做了什么**

1. **P1-2**：`TaskPublish` 的「已发布任务」改为**时间窗加载**（默认最近 60 天 + `加载更多`），不再 `readTasksMany(listTaskDates())` 全量拉取；补上卸载后的 `cancelled` 守卫。
2. **P1-3**：①主区去掉 `key={mode}`；②引入 `dataVersion` 版本号，`DayView`/`WeeklyView`/`TaskPublish`/`StatsView`/`TrashView`/`StickyNotesView` 把它放进取数 effect 依赖 —— 不重挂载也能刷新自身数据；③待发布草稿持久化到 localStorage（全部发布成功才清空）；④周总结在切周/卸载时 **flush** 未落盘的 800ms 防抖内容，并把周总结载入从 `dataVersion` 依赖拆出（否则会覆盖正在输入的草稿）。
3. **P1-4**：`MeetingList` 分页渲染（每页 60 + 加载更多）；`stripHtml` 结果按会议 id 缓存。
4. **P2-1**：新增 `TagBadge.tsx`（`TagBadge` + `TagBadgeList`，收 `Map` 而非数组），替换全部 **14 处**重复渲染。
5. **P2-2**：新增 `Overlay.tsx` 作为 Modal/Drawer 共同基元，补齐 `role="dialog"` / `aria-modal` / `aria-labelledby` / **焦点陷阱** / 初始聚焦 / 关闭归还焦点 / 背景滚动锁 / **浮层栈**；`Modal`、`Drawer` 退化为薄封装（沿用原 class，CSS 未动）。

**结论与决定**

- **纠正了 backlog 里一处不准确的判断**：`<main key={mode}>` **不是**草稿丢失的真正原因。各视图是条件渲染（`{mode === 'x' && <X/>}`），切换页签本来就会卸载组件 —— 有没有 `key` 都一样。真正的修复是**草稿持久化 + 卸载时 flush**。已把这一更正写进 backlog 的 P1-3 行，避免后人重复误判。
- **引入 `dataVersion` 而非全局 store**：项目刻意保持「无 store、纯 props」的直白架构，因此只加一个版本号让各视图自行重取，不引入状态管理库（也避免增加体积）。
- **分页优先于虚拟化**：项目的列表数据天然按时间分片，分页足够；虚拟列表要么引库（体积）、要么自己写（复杂度），在安装包只剩 ~2.8MB 余量的前提下不划算。`TrashView`（500 条上限）/`StickyNotesView`/`DayView`（单日）本身有界，不做处理。
- **`Overlay` 的浮层栈是必需的**，不是过度设计：发布页会「抽屉里再开延期弹窗」，没有栈的话一次 Escape/Tab 会同时作用于多层。

**验证**：`typecheck` exit 0；`build` exit 0；`test:data` 18/18 通过；`grep task-item-tag` 除 `TagBadge.tsx` 外已归零。

**遗留**：P2-3（拆 `TaskPublish`，现约 740 行）、P2-4（`index.ts` 瘦身）、P2-5（CSS 分区收敛，风险高收益低，建议最后做）、P2-6 日期工具去重、P3-1（Markdown sanitize）、P3-9（可访问性铺开）。仍未启动过应用做人工点检。

---

## 2026-10-10（第二轮）—— 优化阶段第一批：P0 全部 + P1 三项 + P2/P3 多数

**背景**：用户确认 1.5.4 在制效果没问题，要求把 [07-optimization-backlog.md](07-optimization-backlog.md) 的 P0–P3 **一起做了**，暂不发版。

**做了什么**（14 个文件新增/重写，20+ 文件修改）

1. **P0-2 / P0-3 数据层地基**：新增 `src/main/jsonStore.ts` —— 原子写（临时文件 + rename）、`readJson` 区分「文件不存在」与「解析失败」（**损坏文件改名隔离为 `.corrupt-<时间戳>`，保留证据、绝不静默覆盖**）、`withDataLock` 全局串行写锁、`reportDataWarning` 告警出口。全部数据模块（tasks/meta/tags/trash/weekly/history/stickyNotes/meetings/migrate）改用该层。
2. **P0-1 反馈链路**：新增 `components/Toast.tsx`（`useToasts` + 气泡栈），`StatusReporter` 类型贯通 12 个组件，错误类反馈走 `'error'` 级别。新增 IPC 通道 `data:warning`（启动期缓冲、`did-finish-load` 后补发）→ 数据问题能真正被用户看到。
3. **P1-1 / P1-6 性能**：新增 `src/main/taskCache.ts` —— 天文件按 `mtimeMs + size` 缓存解析结果 + `Map<taskId, Set<date>>` 索引（由发布/延期/删除/恢复增量维护，查不到时回退全库扫描并回填）。
4. **P1-5 体积**：`@tiptap/*`、`lowlight` 移入 `devDependencies`；`MeetingList` 懒加载 `MeetingEditor`；新增 `npm run size` 守卫。
5. **P2-6 路径统一**：新增 `src/main/paths.ts` 作为路径唯一真源。
6. **其余**：P0-4 search、P2-7 死代码、P2-8 悬空变量、P3-2 附件校验、P3-3 锁文件、P3-4 WebDAV 定时器/退出同步/拉取前快照、P3-5 搜索乱序 + 键盘导航、P3-6 更新超时与取消、P3-7 托盘精确排程、P3-8 统计口径、P3-10 系统主题、P3-11 回收站安全阀 + 恢复不再丢数据、P3-12 zip-slip 校验。
7. 新增 `scripts/test-datalayer.cjs` + `npm run test:data`。

**结论与决定**

- **实测数据纠正了一个预估**：asar 从 19.69 → **6.21 MiB**（−13.5 MiB），但安装包只从 98.99 → **97.20 MB**（−1.79 MB）。原因是 NSIS `maximum` 压缩对 JS 文本约 8:1，**安装包体积主要由 Electron 运行时决定**。已把这个结论写进 backlog，避免后续再对"删依赖瘦身"抱不切实际的期待。
- **测试发现了一个真实行为**：`postponeTask` 对**已完成任务**拒绝延期（返回 `{ok:false, added:0}`）。第一次跑测试时我的断言写错了，反而确认了该保护逻辑有效。
- **写锁做成全局串行而非按键分锁**：单用户桌面程序、写操作都是短促本地 IO，全局锁彻底消除丢更新且无死锁复杂度。**代价是锁不可重入** —— 已在 `tags.deleteTag` 等处按「组合函数不持锁、各步骤各自加锁」的规则处理，并写入约定。
- **`takeTrashItem`（取出即移除）已删除**：恢复失败会永久丢数据，改为 `findTrashItem` + 重放成功后再 `removeTrashItem`。
- **`npm run test:data` 是本轮最有价值的产出**：它把「跨天同步、索引正确性、损坏隔离、原子写、并发不丢更新」这五条最难人工验证的保证变成了可重复执行的 18 项断言。

**验证**：`npm run typecheck` exit 0；`npm run build` exit 0；`npm run test:data` 18/18 通过；`npm run dist` + `npm run size` 通过（97.20 MB）。

**遗留**

- 剩余项：P1-2、P1-3、P1-4、P2-1 ~ P2-5、P2-6 日期去重部分、P3-1、P3-9。
- **未启动过应用**：本轮验证全在编译/构建/集成测试层面，UI 效果与新样式需人工点检（清单见 [05-progress.md](05-progress.md) §5）。
- 安装包已产出但未安装运行。

---

## 2026-10-10 —— 建立记忆库 + 全项目调研

**做了什么**

1. 勘察工作区：Git 状态、未提交改动、目录结构、依赖、构建与打包配置。
2. 用两个只读调研子代理分别完成**主进程**与**渲染层**的全量代码调研，产出两份深度档案（已归档为附录）。
3. 亲自复核关键结论：`npm run typecheck` 与 `npm run build` 均通过；grep 验证「休息日」功能已无残留引用；验证 `AboutModal` 为死代码、`status` 链路的 `status` 从未被渲染、`--fg` / `--text-secondary` 为悬空变量；分析 `app.asar` 内容构成（19.69MB）定位体积优化空间。
4. 建立本记忆库（8 个文件 + 2 份附录）。
5. 确认 DSH 的工作区指令加载机制：`AGENTS.md` / `CLAUDE.md` 从项目根（`.git` 标记）到工作目录逐级自动加载，**首次请求注入，总预算 64KB** —— 因此根级 `AGENTS.md` 保持精简（实测 7.4KB，占预算 11.5%），细节全部放在本目录按需读取。
6. 顺手修正 `README.md` 中因在制品而失效的两处描述（日报「行内编辑含备注」→ 备注改为详情底部独立编辑；目录结构中 `meta.ts` 的「休息日 + 应用设置」→「应用设置」），并在 README 顶部加了「项目记忆库」小节，便于人类开发者发现本目录。
7. 全量校验：`npm run typecheck` 与 `npm run build` 均 exit 0；记忆库 12 个文件的相对链接**断链 0 处**。

**结论与决定**

- **`status` 链路已死**（`App.tsx:89` 定义，9 处传入，JSX 中零处读取）：全项目 30+ 条用户反馈（含全部错误提示）静默丢弃。这是「取消主区底部状态栏」时漏删链路造成的，列为 **P0-1**，需要先定案是恢复状态栏还是改用 Toast。
- **数据层是最高风险**：写盘无原子性 + 读失败静默返回空数组 → 损坏文件会被下一次写入永久覆盖。列为 **P0-2 / P0-3**，建议与「抽 JSON 读写公共层」合并成一次迭代。
- **安装包体积已贴边**：1.5.3 为 98.99MB，Gitee 附件上限 100MB。实测 asar 19.69MB，其中 `highlight.js` 5.16MB + `@tiptap/*`/`prosemirror-*` 约 7MB 是**渲染层专用却被 electron-builder 打进包**的冗余，移入 `devDependencies` 可回收约 13MB。列为 **P1-5**，是全清单中性价比最高的一项。
- **在制品（未提交）已确认完整可编译可构建**：删除「休息日」功能（跨 9 文件）+ 备注改为详情底部独立编辑 + 一轮 UI 打磨（侧栏标题层级、日历刷新按钮）。收尾清单见 [05-progress.md](05-progress.md) §4。
- 两份调研档案移入 `memory-bank/appendix-*.md` 作为**快照型附录**（行号基于 2026-10-10 的工作树），并删除了调查期间产生的临时脚本与根级散落文件。

**遗留 / 下一步**

- 在制品尚未做**运行时人工点检**，也未升版本号 / 写 `CHANGELOG.md` / 更新 `releaseNotes.ts`。
- 优化阶段按 [07-optimization-backlog.md](07-optimization-backlog.md) 的「建议执行顺序」推进，从迭代 1（P0-1 + P0-2/P0-3/P2-6）开始。
- 已知未做的验证：未启动应用点检 UI；未测试 500+ 天数据量下的性能基线（P1 各项的验证需要此基线，建议优化阶段先造数据与测量脚本）。
