# AGENTS.md —— 日志工具（WorkLog）工作区指引

> 本文件在会话首次请求时**自动加载**。这里只放索引与铁律；细节按需读 [`memory-bank/`](memory-bank/README.md)。

## ⚠️ 先读这一段：代码基线是 1.5.3，不是 1.5.4

**2026-10-10：项目整体回退到 1.5.3。** 缘由：另一台电脑升级到 1.5.4 后发现了较多问题，
而 1.5.3 是正在稳定使用的版本，因此把代码整体退回 1.5.3 基线，
并把 1.5.4 那条线的工作（P0–P3 系统性优化 + 日志模块）全部撤下。

- 当前 `package.json` = **1.5.3**；`src/` 下的代码就是 1.5.3 当时的代码。
- **`memory-bank/` 里的详细文档描述的是 1.5.4 那条线**，与当前代码**不完全一致**。
  它们按用户要求被保留下来当**历史参考** —— 里面记录了 1.5.4 改了什么、怎么验证的，
  以及几个真实 bug 的根因（例如图片永远显示不出来的 IPC 类型问题）。
  **读的时候务必对照当前代码核实，不要照搬。**
- 完整备份：分支 `backup/1.5.4-journal-work`、标签 `archive/1.5.4-and-journal`（都指向 `6cf45c3`）。
  想找回 1.5.4 的任何文件：`git checkout backup/1.5.4-journal-work -- <路径>`。
- 回退的详细记录见 [`memory-bank/session-log.md`](memory-bank/session-log.md) 最新一条。

### 这些 1.5.4 才有的东西当前**不存在**，别去找

| 1.5.4 有 | 1.5.3 现状 |
|---|---|
| `src/main/jsonStore.ts`（原子写 / 损坏隔离）、`paths.ts`、`taskCache.ts` | **没有**。1.5.3 直接用 `fs.readFile` / `fs.writeFile` + `JSON.parse` |
| `src/shared/date.ts`（日期唯一实现） | **没有**。日期实现分散在 `storage.ts` 与 `renderer/utils/date.ts` |
| `src/renderer/src/utils/sanitize.ts`（HTML 净化） | **没有** |
| `components/Toast.tsx` / `Overlay.tsx` / `TagBadge.tsx` | **没有**（1.5.3 无 Toast 通道，Modal/Drawer 各自实现） |
| 日志模块（`JournalView.tsx`、`journal.ts`、`journal:*` IPC） | **没有** |
| `src/shared/attachmentUrl.ts` | **没有** |
| `npm run test:data` / `ui:shot` / `size` | **没有**这三个脚本 |

> ⚠️ **因此 memory-bank 里这些内容对当前代码是错的**：铁律 2/3/4/6/7/8/12/16、
> 03-data-model 的 jsonStore/原子写章节、06-conventions 的 IPC 契约章节、07 的 P0–P3 条目。
> **当前代码没有那些保护**：写入不是原子的、读失败会被当成空数据
> —— 这是 1.5.3 已存在的数据风险，改数据层时要留意。

## 这是什么

**日志工具（WorkLog）** —— 个人用的 Windows 桌面工作日志工具。
Electron + React + TypeScript（`strict: true`）+ electron-vite + TipTap 3。

- 无数据库：全部状态是本地**明文 JSON 文件**。开发模式数据在 `<项目>/logs`，打包后 `%APPDATA%/WorkLog/logs`
- 功能：日报 / 周报 / 任务发布（批量 + 区间 + 延期）/ 便签 / 会议纪要 / 统计 / 报表（MD + Word）/
  标签库 / 全局搜索 / 回收站 / 发布历史 / 日历 / 休息日标记 / 备份 / WebDAV 同步 / 双镜像自动更新

## 命令（1.5.3 真实的脚本集）

```bash
npm run dev         # 开发模式（自动开窗 + 热更新）
npm run typecheck   # 两侧 tsc —— 提交前必跑
npm run build       # 构建到 out/ —— 提交前必跑
npm run dist        # 打包 Windows 安装包到 dist/
npm run publish:gitee   # 构建 + 打包 + 发布（更新主源）
npm run publish:github  # 同上（镜像源，需 GH_TOKEN）
```

**没有** ESLint / Prettier；没有单元测试；没有界面截图工具。验证只能靠 `typecheck` + `build` + 手工运行。

## 记忆库索引

| 要做什么 | 读哪个（⚠️ 多为 1.5.4 时代内容，需对照代码） |
|---|---|
| 清点项目家底 / 技术栈 | [01-project-brief.md](memory-bank/01-project-brief.md) |
| 架构、IPC 通道表、环境坑 | [02-architecture.md](memory-bank/02-architecture.md) |
| 数据结构与不变量 | [03-data-model.md](memory-bank/03-data-model.md) |
| 找某功能在哪 | [04-features.md](memory-bank/04-features.md) |
| 进度 / 在制品 | [05-progress.md](memory-bank/05-progress.md) |
| 约定与坑 | [06-conventions.md](memory-bank/06-conventions.md) |
| 优化待办 | [07-optimization-backlog.md](memory-bank/07-optimization-backlog.md) |
| **恢复上下文（先读这个）** | [session-log.md](memory-bank/session-log.md) 最近 1–2 条 |
| 精确签名 / file:line | [appendix-main-process.md](memory-bank/appendix-main-process.md)、[appendix-renderer.md](memory-bank/appendix-renderer.md)（**行号已失准，只用 grep 复核**） |

## 铁律（**仍然适用于 1.5.3 的部分**）

1. **区间共享任务**：一次发布 / 延期会把**同一个 `task.id`** 写入所选**每一天**（多份副本，非引用）。
   `order` 是**唯一按天独立**的字段，其余字段（含 `note`、`done`、`completedAt`）**全局共享**。
   改一个任务**必须**走 `tasks.ts` 的 `updateTask` 同步路径；`deleteTask` 会删除**所有**含该 id 的日期。
2. **新增 / 改名 IPC 必须同步改 3 处**：`src/main/index.ts`、`src/preload/index.ts`、`src/preload/index.d.ts`。
3. **`ipcRenderer.invoke` 的返回类型是未经校验的断言**（返回 `any`）。声明为 `string` 就绝不能返回对象 ——
   1.5.4 曾因此让**日报正文与会议纪要的图片长期无法显示**（对象被插进模板字符串变成 `[object Object]`，
   表现为"破图 + 文件名"）。这条教训与版本无关，**改 IPC 时务必照着做**，并在渲染层实际调用一次验证形状。
4. **渲染层重组件要 `lazy()`**；`MeetingEditor`（TipTap，约 1.3MB chunk）等已是懒加载。
5. **样式用 CSS 变量**（定义在 `main.css` 的 `:root`），不要再新建以"轮次/版本号"命名的 CSS 分区。

## 不要"顺手清理"的写法（都是踩坑修复，改动前先读旁边注释）

1. `scripts/electron-vite.cjs` 删除 `ELECTRON_RUN_AS_NODE`（否则 electron 退化为纯 Node，启动即崩）。
2. `protocol.registerSchemesAsPrivileged` 在模块顶层；`appendSwitch` 放在 `whenReady` 内。
3. **禁止** `app.disableHardwareAcceleration()` —— 会退回软件渲染，弹窗与动画全部卡顿（1.5.2 踩坑并回退）。
4. `Calendar` 的「更新日历」**人为保证转圈 ≥800ms**（否则用户看不到反馈）。
5. `turndown` / `turndown-plugin-gfm` **必须在 `dependencies`**（曾放 devDependencies 导致打包后启动崩溃）。
6. `scripts/publish-gitee.ps1` 需 **UTF-8 BOM**，且 JSON Body 按 UTF-8 字节发送（否则中文发布说明乱码）。
7. `src/main/updater-config.ts` 的 **Gitee 段必须写在 GitHub 段之前**（发布脚本按首次出现读取）。
   该文件被 `.gitignore` 忽略，内含明文令牌。
8. `main.css` 里那段 `caret-line-highlight: none` **是无效 CSS**（已实测 `CSS.supports` 为 false），
   别指望它；但它没有副作用，1.5.3 里保留原样即可。

## 验证与文档维护

- **提交前必跑**：`npm run typecheck` 与 `npm run build`，两者都必须 exit 0。
- 涉及数据层的改动，用仓库 `logs/` 下的真实数据手工验证（开发模式数据就在那里）。
- 发布流程见 [06-conventions.md](memory-bank/06-conventions.md) §7。**注意**：两个发布脚本都把
  `prerelease` 硬编码为 `$false`，所以带 `-beta` 的版本号也会作为**正式发行版**发布，
  `releases/latest` 能取到它（更新器用 `semver.gt` 比较，`1.5.5-beta1 > 1.5.4` 成立）。
- **每轮工作结束更新** [session-log.md](memory-bank/session-log.md)。
