# 03 数据模型与磁盘布局（Data Model）

> 存储根记为 **R**（解析规则见本文 §1）。项目**没有数据库**，全部状态是 R 下的明文文件。
> 类型定义的唯一真源是 [`src/shared/types.ts`](../src/shared/types.ts)。

## 1. 存储根 R 的解析

`src/main/storage.ts` → `getStorageRoot()`

| 场景 | R |
|---|---|
| 打包后 | `app.getPath('appData')/WorkLog/logs` |
| 开发中 | `app.getAppPath()/logs`（即仓库根 `logs/`） |

`migrateStorageRoot()` 仅在**打包版且 R 为空**时执行迁移，来源依次为：
1. `%APPDATA%/WorkLog/pre-update-backup/logs`（NSIS 更新前备份）
2. `<exe 所在目录>/logs`（旧安装目录残留）

复制成功后删除来源。**注意**：若 R 已被写入任何内容则直接跳过，半迁移状态会永久搁置旧备份且不报错。

## 2. 磁盘文件清单

| 相对 R 的路径 | 顶层 JSON 结构 | 主要读写模块 |
|---|---|---|
| `<YYYY>/<YYYY-MM-DD>.json` | `{ tasks: Task[] }` | `tasks.ts`（`tags/search/stats/migrate` 只读） |
| `tags.json` | **裸数组** `Tag[]` | `tags.ts` |
| `stickyNotes.json` | **裸数组** `StickyNote[]` | `stickyNotes.ts` |
| `trash.json` | `{ items: TrashItem[] }` | `trash.ts` |
| `publish-history.json` | `{ records: PublishRecord[] }` | `history.ts`（`index.ts` 组装、`migrate.ts` 升级） |
| `settings.json` | `AppSettings` | `meta.ts` 写；`tray.ts` / `index.ts` 读 |
| `weekly/<YYYY-Www>.json` | `{ weekKey, summary }` | `weekly.ts`（`exporter.ts` 读） |
| `meetings/<id>.md.json` | `Meeting`（**单对象，非数组**） | `meetings.ts` |
| **`journal/<YYYY>/<YYYY-MM-DD>.json`** | `{ date, entries: JournalEntry[] }` | `journal.ts`（**新增**，见 §9） |
| `attachments/<folder>/<ts>_<name>` | 二进制，无元数据文件 | `attachments.ts` |
| `attachments/meetings/<meetingId>/<ts>_<name>` | 二进制 | `meetings.ts` |
| `.migrated-v1.2` | 迁移时间 ISO 字符串 | `migrate.ts` |
| `meeting-templates.json` | 会议模板（`MeetingList` 相关） | 遗留文件，见 §8 |

**R 之外**（不参与备份/同步）：

- `%TEMP%/worklog-update/` —— 更新安装包与 `state.json`（`updater.ts`）
- `%APPDATA%/WorkLog/pre-update-backup/` —— R 的兄弟目录

### 两个易踩的格式细节

- `tags.json` 与 `stickyNotes.json` 是**裸数组**，其余业务文件都是 `{ 键: 数组 }` 包装。
- 天文件在 `tasks.length === 0` 时会被**直接删除**（`tasks.ts` `writeTasks`）。因此「当天无任务」与「文件损坏」在 `readTasks` 层面**无法区分**（见 §7 风险）。

## 3. 核心类型速查

`src/shared/types.ts`：

| 类型 | 要点 |
|---|---|
| `Task` | `id / title / tags[] / done / body(Markdown) / subtasks[] / note / publishedAt / completedAt / order / createdAt / updatedAt` |
| `Subtask` | `id / title / done / tags[]`（仅标题，可勾选、可带标签） |
| `Tag` | `id / name / color('#rrggbb') / createdAt / useCount?`（`useCount` 是查询时填充的**非持久化字段**） |
| `StickyNote` | `id / text / pinned / completed / createdAt / completedAt`（`pinned && !completed` 才显示在日报顶部） |
| `Meeting` | `id / title / date / tags[] / body(HTML) / attachments[] / createdAt / updatedAt` |
| `AttachmentMeta` | `id / name / url(wlattach://) / type('image'\|'file')` |
| `TrashItem` | `id / title / deletedAt / tasks: { date, task }[]` |
| `PublishRecord` | `id / title / tags[] / dates[] / body / subtasks[] / publishedAt / instances: { date, taskId }[]` |
| `AppSettings` | `theme / accent / reminder{enabled,time} / webdav{...} / updateSource` |
| `WeekInfo` | `year / week / weekKey / start / end / dates[7]` |
| `MonthStats` | `year / month / totalDays / daysWithTasks / totalTasks / doneTasks / pendingTasks / tagCounts[] / daily[]`（被复用为**任意区间**统计） |
| `ExportOptions` | 判别联合：`{mode:'day',date}` \| `{mode:'week',weekKey}` \| `{mode:'range',start,end}` |

> `Task` 中**没有** `projectId`。旧的「项目结构层级」功能已整体取消，旧数据里的 `projectId` 字段保留但被忽略（`migrate.ts` 迁移时主动删除发布记录上的 `projectIds`）。

## 4. 头号领域不变量：区间共享任务

这是全项目最反直觉、最容易写错的地方。

**机制**：一次发布或延期，会把**同一个 `task.id`** 写入所选**每一个**日期的天文件。也就是说跨天的不是「引用」，而是**多份内容相同的副本**（含子任务 id 也全部相同）。

派生规则：

1. **`order` 是唯一按天独立的字段。** 每天的副本各自使用自己当天的 `maxOrder + 1`。同步时其余字段整体覆盖，仅保留各天原有 `order`。
2. **其余字段全局共享**，包括 `note`（日报备注）、`done`、`completedAt`、`title`、`tags`、`body`、`subtasks`。在任意一天改备注/勾选，所有天一起变。
3. **同步的唯一实现在 `updateTask`**（`src/main/tasks.ts`）：先在传入 `date` 上定位任务并应用 patch → `datesOfTask()` 全库扫描定位所有含该 id 的日期 → 逐天 `readTasks` / 替换同 id 项（保留当天 order）/ `writeTasks`。
4. **`deleteTask` 忽略传入的 `date` 参数**，完全依赖 `datesOfTask()` 扫描出的日期集合。删除任一天 = 删除所有天。
5. **`datesOfTask()` 是全库扫描**：`listDatesWithTasks()`（遍历 R 的一级目录 + 文件名正则 `^\d{4}-\d{2}-\d{2}\.json$`）再逐日 `readTasks` 全量解析。因此**每一次勾选完成、改标题、改备注都是 O(总天数) 次文件读取**。这是本项目最大的性能瓶颈，见 [07-optimization-backlog.md](07-optimization-backlog.md)。
6. **延期（`postponeTask`）只追加**：先取已有日期集合，重叠日期自动跳过；**已完成任务拒绝延期**（返回 `{ok:false, added:0}`）。
7. **发布历史 `instances`** 是「整批回收」的定位依据：`{ date, taskId }[]`，由 `publishTasks` 的返回值写入。

### 回收站语义：恢复是「重放」而非「还原」

- 删除单个任务：先 `datesOfTask` 收集全部日期的 task 拷贝 → 组成**一个** `TrashItem` → 入回收站 → 删除所有天。
- 删除发布历史整条记录：遍历 `rec.instances` 用 `seenTaskIds` 去重 → 汇集所有实例进一条 `TrashItem` → 逐 id 删除 → 删记录。
- **恢复**：`restoreTasksToDays()` 把每条 task **追加**到其 `date` 文件末尾并重新分配 `order = maxOrder + 1`。原 `order` 与位置丢失；不检查该 id 是否已存在（重复恢复可能产生同 id 重复项）。
- `takeTrashItem()` 是**取出即移除**——恢复过程若失败，条目已从回收站消失。
- `trash.json` 无容量上限、无自动清理、每次操作全量读写。

## 5. 迁移（migrate）

标记文件：`R/.migrated-v1.2`（存在即跳过）。入口 `migrateLegacyData(R)`，在 `app.whenReady()` 中、**注册 IPC 之前**调用。三项迁移：

1. `migrateTags` —— 旧标签缺 `createdAt` 时用 `tags.json` 的 `mtimeMs` 补齐。
2. `migrateWeeklyFiles` —— `weekly/<weekKey>__<projectId>.json` → `weekly/<weekKey>.json`；目标是 `copyFile`（**旧文件保留**）；多候选取首个 `summary` 非空的；目标已存在则跳过。
3. `migratePublishHistory` —— 补 `subtasks/tags/dates/instances/publishedAt`、删除 `projectIds`；对无 `instances` 的旧记录按「标题相同 + 派发时间相差 <24h」在目标日期内重建实例；最后遍历**全部**日期任务，未被任何记录覆盖的补录为新发布记录（`records.unshift`，新记录排最前）。

`resetMigration(R)` 删除标记，用于：**导入备份后**（`backup:import`）与 **WebDAV 拉取后**（`webdavPull`），使旧格式数据在下次启动重新升级。

> 迁移期间无锁、无备份；损坏文件被静默跳过。`migrateWeeklyFiles` 不会删除旧的 `__project` 文件，`resetMigration` 后重跑会再次看到它们（有「目标已存在则跳过」保护）。

## 6. 备份与同步的覆盖范围

`backup.ts` / `sync.ts` 共用同一套 zip 逻辑（`exportBackup` / `importBackup`）。

- **备份 = R 的整目录递归**，包含：任务天文件、`tags.json`、`trash.json`、`publish-history.json`、`settings.json`（**含 WebDAV 明文密码**）、`stickyNotes.json`、`weekly/`、`meetings/`、`attachments/`、`.migrated-v1.2`。
- **不包含**：`pre-update-backup/`、`%TEMP%/worklog-update/`、`out/`、`dist/`。
- WebDAV 远端固定单文件 `worklog-logs.zip`（URL = 配置地址去尾斜杠 + `/worklog-logs.zip`），Basic 认证。
- **`importBackup` 是「合并覆盖」**：同名覆盖，**不删除本地独有文件**。无冲突检测、无版本比较、拉取前不备份远端/本地。`webdavPull` 同理 → 可能静默覆盖本地较新的文件（UI 只显示 `lastSyncAt`）。
- `lastDataMtime(R)` 只统计 **R 的一级文件 + 一级子目录的直接文件**，不递归更深（因此 `attachments/meetings/<id>/x.png` 这类三级文件的时间**不计入**）。主进程用它仅为给 UI 展示，不做实际比对。

### 附件与 `wlattach://` 协议

- URL 形态：`wlattach://attachments/<folder>/<encodeURIComponent(文件名)>`。
  解析后 `hostname === 'attachments'`，`pathname === '/<folder>/<file>'`，拼回 `attachments/<folder>/<file>`。
- 读取侧 `attachmentUrlToPath()` 用 `path.resolve` 归一化后做前缀比较 `startsWith(R/attachments + sep)`，可拦下 `..` 穿越。
- **写入侧 `folder` 参数完全不校验**（`saveAttachmentBuffer` / `importAttachmentFile` 直接 `path.join(R,'attachments', folder)`），渲染层若传 `../../` 会写到 R 之外。这是已知的**读写校验不对称**，属安全待办。
- `sanitizeName()` 只做 `path.basename` + 替换 `\/:*?"<>|` → `_`，未处理 `.` / `..` / Windows 保留设备名（`CON`、`NUL`）；但文件名固定带 `${Date.now()}_` 前缀，实际无法形成纯 `..`。
- 协议注册：`registerSchemesAsPrivileged` 在模块顶层（须早于 app ready，且有 `typeof protocol !== 'undefined'` 保护）；`protocol.handle('wlattach')` 在 `whenReady` 内注册，路径非法返回 403。
- 附件历史包袱：早期附件曾放在会议目录下，`saveMeeting` 写前会扫描目录删除同 id 的旧命名文件；`meeting-templates.json` 是遗留文件，当前代码路径已不产生它。

## 7. 错误处理与数据安全

> 2026-10-10 优化批次**已加固**这一层。下面是**现状**；改造前的原始问题见 [07-optimization-backlog.md](07-optimization-backlog.md) P0-2 / P0-3。

### 已建立的保证（`src/main/jsonStore.ts`）

| 保证 | 机制 |
|---|---|
| **写盘原子** | `writeJson` 先写同目录临时文件，再 `rename` 覆盖。任何时刻磁盘上要么是旧内容、要么是新内容，不会出现截断的半个文件。失败时清理临时文件并上报 `write-failed` 告警。 |
| **读失败不静默** | `readJson` 只把 `ENOENT` 当「正常空态」；**空文件或解析失败**会把原文件改名隔离为 `<file>.corrupt-<时间戳>`（保留证据），发出 `data:warning` 告警，再返回 fallback。因此损坏内容**永远不会被下一次写入覆盖**。 |
| **告警可达用户** | `data:warning` IPC 通道 → `App.tsx` 订阅 → Toast（error 级）。启动期（窗口未就绪）的告警先缓冲，`did-finish-load` 后补发。 |
| **并发写不丢更新** | `withDataLock` 全局串行写锁。**锁不可重入**：组合函数不持锁、各步骤各自加锁。 |
| **读一致** | 读操作不加锁 —— 原子写保证读到的永远是某个完整版本。 |

### 性能层（`src/main/taskCache.ts`）

- 天文件按 `mtimeMs + size` 缓存解析结果：文件没变就只 `stat` 不 `readFile`/`JSON.parse`。
- 「任务 → 日期」索引 `Map<taskId, Set<date>>`：首次惰性全量构建，之后由发布 / 延期 / 删除 / 恢复**增量维护**；索引查不到时**回退全库扫描并回填**，正确性不依赖索引完整性。
- **外部整体替换数据后必须 `resetTaskCache()`**（导入备份、WebDAV 拉取已接好）。

### 仍然存在的注意点

1. **`updateTask` 补丁口子偏宽**：IPC 层把渲染层的 `Partial<Task>` 直接透传（比声明的 `TaskPatch` 更宽），`completedAt` 可被任意覆盖；显式 `completedAt` 优先于 `done` 推导值（这是**刻意保留**的既有语义，已在代码注释说明）。
2. **天文件删除即丢失**：空数组仍直接删除天文件；因为读失败已改为隔离而非返回空，两者不再混淆。
3. **回收站有 500 条安全阀**：超出时保留最新并**通过告警通道告知用户**（不静默丢弃）。恢复流程已改为「先重放成功再移出回收站」，且按 `date::id` 去重、跳过已存在的 id。
4. **备份导入是「合并覆盖」**：不删本地独有文件、无冲突检测。拉取前会自动在 `userData/pre-pull-backup` 留一份本地快照（保留 3 份，置于数据根之外以免被再次打包上传）。

**改动数据层时的要求**：见 [06-conventions.md](06-conventions.md) §3；改完必须跑 `npm run test:data`。

## 8. 时间与日期约定

- 所有业务日期字符串为 `YYYY-MM-DD`，一律按**本地时区**解析（`new Date(dateStr + 'T00:00:00')`），无 UTC 归一。
- ISO 周：周一起始；ISO 年取**周四所属年**；周序 = `floor(dayOfYear(周四)/7)+1`；`weekKey = YYYY-Www`（补零 2 位）。
- `weekKeyToDates()` 以「1 月 4 日必落在第 1 周」反推周一。
- **只有一份实现**（1.5.4 起统一）：[`src/shared/date.ts`](../src/shared/date.ts) 是 `toDateStr/weekdayName/getWeekInfo/weekKeyToDates/enumerateDates` 的**唯一**实现；`src/main/storage.ts` 与 `src/renderer/src/utils/date.ts` 都只是 re-export（渲染层另保留 `weekdayOf`/`weekInfoOf` 作为别名）。**不要**在任何一侧另写一份 —— 见 [06-conventions.md](06-conventions.md) 与 AGENTS.md 铁律 7。
- 日历的「休息日」判定来自 `src/renderer/src/utils/holidays.ts`（`isRestDay`：法定假日，或未被调休占用的周末），按年联网拉取 `https://timor.tech/api/holiday/year/<year>`，与业务数据无关。

> **已移除的功能**：早期版本有天数级「休息日」标记（`R/rest.json` + `rest:get`/`rest:set` IPC + 日报「休息日」勾选框 + 周报休息日徽标）。该功能已在 1.5.4 开发中**整体删除**，`meta.ts` 中的 `readRestMap`/`isRest`/`setRest` 与 preload 对应方法均已移除。旧数据中若残留 `rest.json`，现已无人读取，可安全删除。

## 9. 日志（journal）—— 2026-10-10 新增，同日改为「一天一篇」

「日志」是**与任务相互独立**的个人手记。两者唯一的联系是：日志可以**按需关联**当天任务，也可以完全不关联。

> ⚠️ **模型在当天改过一次**：最初是「一天多条 `entries[]`」，界面上必然表现成一叠卡片；
> 用户明确要「像 Word 那样一路写下去的连续文档」，两者本质冲突，因此改为**一天一篇**。
> 改动发生在**没有任何真实数据之前**（唯一天真实数据是用户手写的一条测试内容，已兼容读回）。

### 文件布局

```
R/journal/<YYYY>/<YYYY-MM-DD>.json
{
  "date": "2026-10-10",
  "body": "<p>富文本 HTML</p>",   // TipTap 产出；渲染前必须经 sanitizeHtml
  "attachments": [ { id, name, url, type } ],  // 非图片附件（图片内联在 body 的 <img> 里）
  "mountedTasks": [ { taskId, date, title, done } ],
  "createdAt": "ISO", "updatedAt": "ISO"
}
```

### 不变量与语义

| 项 | 约定 |
|---|---|
| 一天几篇 | **一篇**。整天在一个 `body` 里连续书写，不再分条目、不再有时间头 |
| 保存语义 | **覆盖式**。未传的字段保持原值（只改正文时不必回传附件列表）；`createdAt` 首次写入后不再变 |
| 空天文件 | 正文无文字、无附件、无关联任务时**删除文件**，不留空壳（与 `weekly.ts` 一致） |
| `mountedTasks` | **快照**：`title` 是关联当时的标题，任务改名不影响日志；`done` 也是当时的状态。保留 `taskId`+`date` **仅**用于跳转与「原任务已失效」检测。**只存标题与完成状态，不抄正文**；按 `taskId` 去重 |
| 日期校验 | `date` 来自渲染层并参与拼接路径，`journal.ts` 强制 `/^\d{4}-\d{2}-\d{2}$/`，非法值抛错 —— 这是**路径穿越防护**，不可移除 |
| 并发 | 读改写全程走 `withDataLock`；20 并发保存后正文必是完整的一版（无半截文件，有测试） |
| 损坏处理 | 与任务天文件同一套 `jsonStore` 语义：损坏文件隔离为 `.corrupt-<时间戳>` + 发 `data:warning` |

### 向后兼容：旧格式 `entries[]`（**重要**）

仍能读最初的 `{ date, entries: [{ time, body, … }] }`：

- 按时间顺序把各条正文**合并成一整篇**；
- **多条**时在每条前插入 `<p><strong>时间</strong></p>` 保留时间信息；
  **单条时不插入** —— 避免凭空多出一个时间行（用户真实数据正是单条形态）；
- 各条的 `attachments` / `mountedTasks` 合并（关联任务按 `taskId` 去重），
  `createdAt` 取最早、`updatedAt` 取最晚；
- **只在读取时转换，绝不回写**：文件保持原样，直到用户真的保存那一天。
  这样即使转换逻辑将来有问题，原始数据也还在。

### 与 1.5.4 的兼容（用户硬约束）

- **1.5.4 完全不受影响**：它只会用 `dayFilePath(root, date)` **按日期构造**任务路径，不递归扫描目录，
  因此多出一个 `journal/` 目录对它无感。
- **备份/同步自动包含**：`exportBackup` 是整目录打包，WebDAV 推拉的都是整个 zip。
- `tasks.listDatesWithTasks` 会枚举根目录下每个子目录再匹配 `<年>/YYYY-MM-DD.json`。
  `journal/<年>/<日期>.json` 因为**多一层**而侥幸不被误判 —— 但这是巧合，不是保证。
  已**显式**加上「目录名必须是 4 位年份」的约束，并用测试锁死（`test:data` §12.12）。
- **真实数据副本实测 8/8 PASS**：任务日期扫描一致、每天任务内容**逐字节一致**、日志读回、
  关联任务快照、旧格式合并、旧格式不回写、左栏摘要、用户真实旧格式内容保留。
- **将来任务正文改富文本时**：现有任务的 `body` 是 markdown，日志的是 HTML。
  两者目前**并存、互不影响**（不同文件、不同字段）。迁移方案见 [07-optimization-backlog.md](07-optimization-backlog.md) 的 Phase 1f。
