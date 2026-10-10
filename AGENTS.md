# AGENTS.md —— 日志工具（WorkLog）工作区指引

> 本文件在会话首次请求时**自动加载**（DSH 会从项目根逐级注入 `AGENTS.md`，总预算 64KB）。
> 因此这里**只放索引与铁律**，细节一律去 [`memory-bank/`](memory-bank/README.md) 按需读。
> ⚠️ **动手改代码前，先读 [memory-bank/06-conventions.md](memory-bank/06-conventions.md)**（约定）与 **[memory-bank/03-data-model.md](memory-bank/03-data-model.md)**（数据结构与不变量）。

## 这是什么

**日志工具（WorkLog）** —— 个人用的 Windows 桌面工作日志工具。Electron 44 + React 19 + TypeScript（`strict: true`）+ electron-vite 5 + TipTap 3。

- 当前版本 `package.json` = **1.5.3**（工作树含**未提交的 1.5.4 在制品**，见 [memory-bank/05-progress.md](memory-bank/05-progress.md) §3）
- 无数据库：全部状态是本地**明文 JSON 文件**。开发模式数据在 `<项目>/logs`，打包后 `%APPDATA%/WorkLog/logs`
- 功能：日报 / 周报 / 任务发布（批量 + 区间 + 延期）/ 便签 / 会议纪要 / 统计 / 报表（MD + Word）/ 标签库 / 全局搜索 / 回收站 / 发布历史 / 日历 / 备份 / WebDAV 同步 / 双镜像自动更新

## 命令

```bash
npm run dev         # 开发模式（自动开窗 + 热更新）
npm run typecheck   # 两侧 tsc —— 提交前必跑
npm run build       # 构建到 out/ —— 提交前必跑
npm run test:data   # 数据层 + 日期 + HTML 净化 集成测试（54 项断言）—— 改 src/main 或 utils 后必跑
npm run size        # 安装包体积守卫（需先 npm run dist）
npm run dist        # 打包 Windows 安装包到 dist/
npm run publish:gitee   # 构建 + 打包 + 发布（更新主源）
npm run publish:github  # 同上（镜像源，需 GH_TOKEN）
```

## 记忆库索引

| 要做什么 | 读哪个 |
|---|---|
| 清点项目家底 / 技术栈 / 命令 | [01-project-brief.md](memory-bank/01-project-brief.md) |
| 改代码（**先读**）| [06-conventions.md](memory-bank/06-conventions.md) |
| 碰数据 / 存储 / 备份 / 迁移（**先读**）| [03-data-model.md](memory-bank/03-data-model.md) |
| 找某功能在哪、加新功能 | [04-features.md](memory-bank/04-features.md) |
| 架构、IPC 通道表、安全边界、环境坑 | [02-architecture.md](memory-bank/02-architecture.md) |
| 做到哪了 / 下一步 / 在制品收尾 | [05-progress.md](memory-bank/05-progress.md) |
| 做优化（性能 / 体积 / 可维护性） | [07-optimization-backlog.md](memory-bank/07-optimization-backlog.md) |
| 恢复上次会话上下文 | [session-log.md](memory-bank/session-log.md) 最近 2–3 条 |
| 精确签名 / file:line 定位 | [appendix-main-process.md](memory-bank/appendix-main-process.md)、[appendix-renderer.md](memory-bank/appendix-renderer.md)（**快照，行号可能失准，用 grep 复核**） |

## 铁律

1. **区间共享任务**：一次发布 / 延期会把**同一个 `task.id`** 写入所选**每一天**（多份副本，非引用）。`order` 是**唯一按天独立**的字段，其余字段（含 `note`、`done`、`completedAt`）**全局共享**。任何"改一个任务"的逻辑**必须**走 `tasks.ts` 的 `updateTask` 同步路径；`deleteTask` 会删除**所有**包含该 id 的日期。详见 [03-data-model.md](memory-bank/03-data-model.md) §4。
2. **所有数据读写必须走 [`src/main/jsonStore.ts`](src/main/jsonStore.ts)**：`writeJson` 是原子的（临时文件 + rename），`readJson` 会把**损坏文件改名隔离为 `.corrupt-<时间戳>` 并发出 `data:warning` 告警**，绝不静默当空。**不要**再自己写 `fs.readFile` + `JSON.parse` + `catch {}`，也不要直接 `fs.writeFile` 覆盖数据文件。
3. **写锁不可重入**：`jsonStore.withDataLock` 是**全局串行写锁**。一个已经持锁的函数**不能**再调用另一个会加锁的函数（会死锁）。规则是「组合函数不持锁、各步骤各自加锁」——参见 `tags.deleteTag`（先加锁改标签库、锁释放后再调 `removeTagFromAllTasks`）。
4. **天文件读取走 `readTasks`（带 mtime 缓存）与 `taskCache` 的索引**；`datesOfTask` 已由「任务→日期」索引支撑，**不要**在它之上再叠加循环读盘。外部整体替换数据（导入备份 / WebDAV 拉取）后**必须**调用 `resetTaskCache()`。
5. **`onStatus` 已改造为 Toast 通道**（`StatusReporter = (msg, level?) => void`）。新增用户反馈请用 `level: 'error'` 标注失败类消息；**不要再定义只写不读的状态**。
6. **渲染任何 HTML 都必须经净化**：Markdown 走 `renderMarkdown`（内部已 `sanitizeHtml`），TipTap 等原始 HTML 走 `RichView kind="html"`。**禁止**直接 `dangerouslySetInnerHTML` 注入未经 `utils/sanitize.ts` 的内容。
7. **日期与 ISO 周只有一个实现**：[`src/shared/date.ts`](src/shared/date.ts)。`src/main/storage.ts` 与 `renderer/utils/date.ts` 都只是 re-export；**不要**在任何一侧另写一份。
8. **复用既有基元**：标签徽章用 `TagBadgeList`（收 `Map<string, Tag>`）；弹窗/抽屉用 `Modal` / `Drawer`（都是 `Overlay` 的薄封装，自带焦点陷阱与 ARIA）；图标按钮要有 `aria-label`（`title` 不是可靠的可访问名）。
9. **`onTasksChanged` 名字有误导性**：它只刷新日历打点，**不刷新任务数据**（真正的刷新靠 `dataVersion`）。
10. **视图在切换页签时会被卸载**（各视图是条件渲染，主区已不再用 `key={mode}`）。有草稿的页面必须**自己持久化或在卸载时 flush**：`TaskPublish` 待发布列表存 localStorage，`WeeklyView` 周总结在 cleanup 里 flush。
11. **新依赖前先算体积**：安装包必须 < 100MB（Gitee 附件上限），当前实测 **97.20MB，余量仅 ~2.8MB**。`@tiptap/*`、`lowlight` 等**渲染层专用**包必须放 `devDependencies`（Vite 照常打包）。注意：**安装包体积主要由 Electron 运行时决定**，删依赖收益有限（实测 asar 少 13.5 MiB 只让安装包小 1.79 MB）。
12. **渲染层重组件必须 `lazy()`**；`MeetingEditor`（TipTap，1.3MB chunk）与 `TaskPublish` 都已是懒加载，新增同类依赖照做。
13. **样式只用 CSS 变量**（17 个，定义在 `main.css` 的 `:root`），派生色用 `color-mix`；新增强调色只需加一两行。**不要**再新建以"轮次/版本号"命名的 CSS 分区。
14. **类型质量基线**：全项目 `any` 为 0、`@ts-ignore` 为 0，两侧 `strict: true`。请保持。
15. **新增 / 改名 IPC 必须同步改 3 处**：`src/main/index.ts`、`src/preload/index.ts`、`src/preload/index.d.ts`（渲染层的 `window.api` 全局类型来自最后这个文件）。

## 不要"顺手清理"的写法

代码里有若干**看着多余、实为踩坑修复**的写法，改动前先读旁边的中文注释：

1. `scripts/electron-vite.cjs` 删除 `ELECTRON_RUN_AS_NODE`（否则 electron 退化为纯 Node 模式，启动即崩）。
2. `protocol.registerSchemesAsPrivileged` 在模块顶层 + `typeof protocol !== 'undefined'` 保护；`app.commandLine.appendSwitch` 放在 `whenReady` 内（electron-vite dev 下对象未初始化）。
3. **禁止再调用 `app.disableHardwareAcceleration()`** —— 会退回软件渲染，弹窗 blur / 阴影 / 动画全部卡顿（1.5.2 踩坑并回退）。压内存只能从渲染层懒加载入手。
4. `main.css` 的「v3.1：编辑器黄框兜底」分区对应 `CaretLineHighlight` 开关。
5. `Calendar` 的「更新日历」**人为保证转圈 ≥800ms**（静态年份数据瞬间返回，否则用户看不到反馈）。
6. `turndown` / `turndown-plugin-gfm` **必须在 `dependencies`**（曾放 devDependencies 导致打包后启动崩溃）。
7. `scripts/publish-gitee.ps1` 需 **UTF-8 BOM**，且 JSON Body 按 UTF-8 字节发送（否则 PowerShell 5.1 解析出错 / 中文发布说明乱码）。
8. `src/main/updater-config.ts` 的 **Gitee 段必须写在 GitHub 段之前**（发布脚本按首次出现读取）。该文件被 `.gitignore` 忽略，内含明文令牌。

## 验证与文档维护

- **提交前必跑**：`npm run typecheck` 与 `npm run build`，两者都必须 exit 0。项目**没有** ESLint / Prettier 配置（代码里的 `eslint-disable` 注释不会被任何工具执行）。
- 涉及数据层的改动，用仓库 `logs/` 下的真实数据手工验证（开发模式数据就在那里）。
- **每轮工作结束必须更新记忆库**：往 [session-log.md](memory-bank/session-log.md) 追加一条；功能 / 数据结构 / 发布版本有变化时对应更新 `04` / `03` / `05`；修掉优化项则从 `07` 移入其「已完成」表。完整对照表见 [06-conventions.md](memory-bank/06-conventions.md) §8。
- 发布流程（升版本 → `CHANGELOG.md` + `releaseNotes.ts` → 双源发布 → 打标签）见 [06-conventions.md](memory-bank/06-conventions.md) §7。
