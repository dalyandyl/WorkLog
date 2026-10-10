# WorkLog v1.5.3 主进程技术档案（只读调研）

范围：`src/main/` 全部模块 + `src/preload/index.ts`。仅静态阅读，未修改任何文件。

## 1. 磁盘数据布局

存储根 `root`（下称 R）由 `storage.ts:19 getStorageRoot()` 解析。除附件/会议外，几乎所有 JSON 都是 `path.join(R, 固定名)`，**没有统一的路径常量表**，各模块自行拼接。

| 模块 | 拼接方式（file:line） | 相对 R 的路径 | 顶层 JSON 结构 |
|---|---|---|---|
| tasks | `path.join(root, year, `${date}.json`)`（tasks.ts:7-10） | `<YYYY>/<date>.json`，`date`=YYYY-MM-DD | `{ tasks: Task[] }`；`tasks.length===0` 时**删除文件**（tasks.ts:39-47） |
| tags | `path.join(root,'tags.json')`（tags.ts:8-10） | `tags.json` | **裸数组** `Tag[]`（非对象） |
| trash | `path.join(root,'trash.json')`（trash.ts:5-7） | `trash.json` | `{ items: TrashItem[] }` |
| weekly | `path.join(root,'weekly',`${weekKey}.json`)`（weekly.ts:8-10） | `weekly/<YYYY-Www>.json` | `{ weekKey, summary }` |
| history | `path.join(root,'publish-history.json')`（history.ts:9-11） | `publish-history.json` | `{ records: PublishRecord[] }` |
| meta | `path.join(root,'settings.json')`（meta.ts:7-9） | `settings.json` | `AppSettings`（含 `webdav`、`reminder`、`updateSource`） |
| stickyNotes | `path.join(root,'stickyNotes.json')`（stickyNotes.ts:5-9） | `stickyNotes.json` | **裸数组** `StickyNote[]`（非对象） |
| attachments | `path.join(root,'attachments',folder)`（attachments.ts:5-7）；文件名 `${Date.now()}_${sanitizeName(name)}`（:16-18） | `attachments/<folder>/<ts>_<name>` | 二进制，无元数据文件 |
| meetings | `path.join(R,'meetings',`${m.id}.md.json`)`（meetings.ts:8-14） | `meetings/<id>.md.json` | `Meeting` 对象（**单对象，非数组**） |
| meetings（附件） | `path.join(R,'attachments','meetings',<meetingId>)`（meetings.ts:17-19） | `attachments/meetings/<id>/` | 二进制；删除会议时整目录 `fs.rm`（:103） |
| migrate | `path.join(root,'.migrated-v1.2')`（migrate.ts:9-11） | `.migrated-v1.2` | 迁移时间 ISO 字符串 |
| storage | `%APPDATA%/WorkLog/logs`（打包，storage.ts:21）或 `<appPath>/logs`（dev，:23） | 根本身 | — |
| updater | `path.join(app.getPath('temp'),'worklog-update')`（updater.ts:87） | 临时目录，**不在 R 内** | `state.json` = `{version,installer,downloadedAt}` + 安装包 |

**共享同一文件的模块**

- `settings.json`：`meta.ts` 读写；`tray.ts`（提醒）读；`index.ts`（同步/更新源）读；写设置时联动 `setUpdateSource`（index.ts:348-352）。
- **任务天文件被 5 个模块共享读**：`tasks.ts`、`tags.ts`（用量统计 + 标签删除联动）、`search.ts`、`stats.ts`、`migrate.ts`。
- `publish-history.json`：`history.ts`、`migrate.ts`、`index.ts`。
- `weekly/*.json`：`weekly.ts`、`exporter.ts`、`migrate.ts`。
- `attachments/**`：`attachments.ts`、`meetings.ts`、`backup.ts`/`sync.ts`（打包）、`index.ts`（`wlattach` 协议处理）。
- `trash.json`：仅 `trash.ts` 写；`index.ts` 构造条目（`:227-234`、`:317-322`）。
- `migrate.ts` 直接硬编码 `tags.json`/`weekly/`/`publish-history.json` 路径（migrate.ts:122、:77），绕过各模块导出函数。

## 2. 模块职责与导出

### storage.ts（153 行）
存储根解析 + 日期/ISO 周工具，无状态、无 IO 副作用（除迁移）。
- `getStorageRoot(): string` — 打包 → `appData/WorkLog/logs`；dev → `app.getAppPath()/logs`。
- `migrateStorageRoot(): Promise<void>` — 仅在打包 且 目标目录为空时执行；来源依次为 `%APPDATA%/WorkLog/pre-update-backup/logs`、`<exe目录>/logs`，成功后删除来源。
- `toDateStr(d: Date): string`（本地时区，非 UTC）、`weekdayName(dateStr): string`（`周日..周六`）。
- `getWeekInfo(dateStr): WeekInfo` — 周一为一周起点，ISO 年取**周四所属年**，周序 = `floor(dayOfYear(周四)/7)+1`。
- `weekKeyToDates(weekKey): string[]`（非法 key 返回 `[]`）、`enumerateDates(start,end): string[]`（含端点）。

### tasks.ts（304 行）
任务 CRUD、跨天共享同步、发布/延期/回收站恢复、标签联动。
- `dayFilePath(root,date)`, `sortTasks(tasks)`（未完成在前，再按 order）。
- `readTasks(root,date): Promise<Task[]>` — 容错补 `subtasks/note/publishedAt/completedAt`（:26-32），**解析失败静默返回 `[]`**。
- `createTask(root,date,input): Promise<Task>`、`updateTask(root,date,taskId,patch): Promise<Task|null>`、`deleteTask(root,date,taskId): Promise<{ok}>`。
- `datesOfTask(root,taskId): Promise<string[]>`、`listDatesWithTasks(root): Promise<string[]>`、`readTasksMany(root,dates)`。
- `reorderTasks(root,date,orderedIds)`、`publishTasks(root,dates,input): Promise<{count,instances}>`、`postponeTask(root,date,taskId,newDates): Promise<{ok,added}>`、`restoreTasksToDays(root,entries)`、`removeTagFromAllTasks(root,tagId)`。

### tags.ts（100 行）
全局标签库 + 用量统计 + 删除联动。
- `tagsPath(root)`、`readTags(root): Promise<Tag[]>`（补 `createdAt`）。
- `listTags(root)` — 读全部日期文件算 `useCount`（含子任务），按中文名排序。
- `createTag(root,name,color)`（重名返回 null）、`renameTag(root,id,name)`、`recolorTag(root,id,color)`、`deleteTag(root,id)` → 同时调用 `removeTagFromAllTasks`。

### trash.ts（56 行）
`trash.json` 单文件 CRUD，整批条目为不可分割单元。
- `trashPath(root)`、`readTrash(root): Promise<TrashItem[]>`、`listTrash`（按 `deletedAt` 倒序）。
- `addTrashItem(root,item)`（`unshift`）、`takeTrashItem(root,id): Promise<TrashItem|null>`（取出即移除）、`removeTrashItem`、`clearTrash`。

### weekly.ts（62 行）
周总结持久化与周导航。
- `weeklyPath(root,weekKey)`、`readWeeklySummary(root,weekKey): Promise<WeeklySummary>`（不存在时 `exists:false`）。
- `writeWeeklySummary(root,weekKey,summary)` — 空白文本 → 删除文件。
- `getWeekInfoByKey(weekKey): WeekInfo|null`、`shiftWeekKey(weekKey,delta): string|null`。

### history.ts（51 行）
发布批次记录（用于发布页管理与整批回收）。
- `historyPath(root)`、`addPublishRecord(root,record)`、`readPublishRecords(root)`、`deletePublishRecord(root,id): Promise<{ok}>`。

### exporter.ts（131 行）
纯函数式 Markdown 生成（不写盘，写盘在 index.ts）。
- 内部：`tagNameMap`、`tagLabel`、`taskOverviewLines`（子任务缩进 4 空格）、`taskBodySection`、`daySection`。
- `buildDayMarkdown(root,date)`、`buildWeekMarkdown(root,weekKey)`（遍历该周 7 天 + 周总结）、`buildRangeMarkdown(root,start,end)`。标签渲染为 `` `#名称` ``。

### meta.ts（65 行）
设置读写 + 分层默认值。
- `settingsPath(root)`、`readSettings(root): Promise<AppSettings>`（逐字段兜底 `DEFAULT_SETTINGS`）、`writeSettings(root,s)`。`DEFAULT_SETTINGS.updateSource='auto'`，webdav `autoMode:'off'`、`intervalMinutes:30`。

### stickyNotes.ts（103 行）
便签 CRUD，**唯一实现串行锁的模块**（`withNotesLock`，:26-32）。
- `listStickyNotes(root)`（按 createdAt 倒序）、`addStickyNote(root,text)`（默认 `pinned:true`）、`updateStickyNote(root,id,patch)`、`deleteStickyNote(root,id)`（彻底删除，不进回收站）。

### search.ts（69 行）
全库内存检索，最多 50 条。
- `searchTasks(root,query): Promise<SearchHit[]>` — 命中范围：标题 / 子任务标题 / 标签名 / 正文（先用 `/<[^>]+>/g` 去 HTML 标签）；返回前 `hits.reverse()`，故结果按日期**倒序**。

### stats.ts（61 行）
区间统计（`MonthStats` 结构复用为任意区间）。
- `rangeStats(root,start,end): Promise<MonthStats>` — 逐日 `readTasks`，累计 `totalTasks/doneTasks`、按标签计数（**仅任务级标签，不含子任务**）、`daily[]` 含无任务日。

### backup.ts（57 行）
Zip 打包/恢复整目录。
- `exportBackup(root,destZip)` — 递归 `addDirToZip`，`zip.addLocalFile(full, base)` 保留相对路径（已实测：`2026/2026-01-05.json`、`attachments/meetings/abc/x.png`）。
- `importBackup(root,srcZip)` — 解压到 `os.tmpdir()/worklog-import-*` 后**合并**（`mergeDirs` 覆盖同名、不删除本地多余文件），finally 清理临时目录。
- **不参与备份/同步的内容**：`worklog-update/`（临时目录）、`pre-update-backup/`（R 的兄弟目录）、`stickyNotes.json` 虽在 R 内**包含**。

### migrate.ts（197 行）
一次性历史迁移，标记文件 `.migrated-v1.2`。
- `MIGRATION_MARKER`、`markerPath(root)`、`isMigrated(root)`、`resetMigration(root)`（删标记，导入/拉取旧备份后重跑）。
- `migrateLegacyData(root)` — 顺序执行 3 个内部迁移后写标记：
  1. `migrateTags`：旧标签无 `createdAt` → 用 `tags.json` 的 `mtimeMs` 补齐。
  2. `migrateWeeklyFiles`：`weekly/<weekKey>__<projectId>.json` → `weekly/<weekKey>.json`；目标已存在则跳过；多候选时选**首个 summary 非空**的，`copyFile` 复制（**旧文件保留**）。
  3. `migratePublishHistory`：补 `subtasks/tags/dates/instances/publishedAt`、删除 `projectIds`；对无 `instances` 的旧记录按「标题相同 + 派发时间相差 <24h」在目标日期内重建实例；遍历全部日期任务，未被任何记录覆盖的补录为新发布记录（`records.unshift`，**新记录排最前**）。

### sync.ts（94 行）
WebDAV 全量同步（远端固定 `worklog-logs.zip`，与手动备份同源）。
- `authHeader(cfg)`（Basic base64）、`fileUrl(cfg)`（去掉 url 尾部 `/` 后 + `/worklog-logs.zip`）。
- `lastDataMtime(root): Promise<number>` — 只遍历 **R 的一级项 + 其下一级文件**（目录不递归更深），忽略根级以外层级。
- `webdavPush(root,cfg)` — `exportBackup` 到临时 zip → `net.fetch(PUT)` 上传，finally 清理。
- `webdavPull(root,cfg)` — GET 下载 → `importBackup` 合并 → `resetMigration`。

### attachments.ts（78 行）
附件落盘与 `wlattach://` 解析。
- `attachmentsDir(root,folder)`、`sanitizeName(name)`（`path.basename` + 替换 `\/:*?"<>|` → `_`，空则 `file`）。
- `saveAttachmentBuffer(root,folder,name,buf)`、`importAttachmentFile(root,folder,srcPath)` → 均返回 `{url,file}`。
- `toAttachmentUrl(folder,safeName)` = `wlattach://attachments/<folder>/<encodeURIComponent(safeName)>`（**协议权威段承载 `attachments`**，不在 path 里）。
- `attachmentUrlToPath(root,url): string|null` — 校验 protocol 为 `wlattach:`，`decodeURIComponent(u.hostname + u.pathname)` 去前导 `/`，`path.resolve(R, rel)`，要求 `startsWith(path.join(R,'attachments') + path.sep)`。
- `deleteAttachmentFile(root,url): Promise<boolean>`。

### updater.ts（453 行）
Gitee/GitHub 双镜像更新，自研（非 electron-updater），检测/下载/校验/安装四段。
- `setUpdateSource(source)`、`initUpdater(cb)`（设置 `broadcast` 与 `updateDir`）、`checkForUpdates()`、`downloadUpdate()`、`installUpdate()`。
- 内部：`channelCfg`、`parseTagVersion`、`parseLatestYml`、`installerFromYml`（取 `files[0].url`，回退 `path`+`sha512`）、`isNewer`（`semver.gt(remote, app.getVersion())`）、`streamDownload`（流式 + 增量 sha512 + progress）、`giteeApiUrl/giteeApiGet/giteeFetchText/giteeGetPlan`、`githubApiJson/githubGetPlan`、`channelsFor/resolveUpdatePlan`。
- 事件通道：**统一走外壳 IPC `update:event`**，payload 为 `{ channel, payload }`，内层 channel ∈ `checking | available | not-available | progress | downloaded | error`（`index.ts:78-82` 广播，preload `onUpdateEvent` 订阅）。

### updater-config.ts（23 行）
`UPDATE_CONFIG = { gitee:{owner,repo,token}, github:{owner,repo,token} }`；文件被 `.gitignore` 忽略，**Gitee 明文 token 会被打进安装包**。注释要求 Gitee 段必须写在 GitHub 之前（发布脚本按首次出现读取）。

### tray.ts（122 行）
托盘图标（运行时用 zlib 手写 PNG，无图片资源依赖）+ 提醒调度。
- `makeTrayPng(size=32): Buffer`（IHDR/IDAT/IEND + 自实现 CRC32）、`createTray(showWindow)`（优先 `resources/icon.png` 或 `build/icon.png`，失败退回内置图标）。
- `startReminder(storageRoot)` — `setInterval` **每 30 秒**读一次 `settings.json`，`HH:MM` 相等且 `lastFired !== today` 时发系统通知。

### meetings.ts（104 行）
会议纪要文件 CRUD（每会议一文件，按 id 命名）。
- `meetingAttachmentsDir(R,meetingId)`、`listMeetings(R)`（按 `date` 倒序、同日期按 `createdAt` 倒序；坏文件仅 `console.error` 跳过）、`saveMeeting(R,meeting)`（写前扫描目录删除同 id 的旧命名文件，:60-77）、`deleteMeeting(R,id)`（删除文件 + 递归删除附件目录）。

### meetingExport.ts（51 行）
富文本 → Markdown。
- 共享 `TurndownService`（atx/fenced/`-`/`*`）+ `gfm` 插件；`mark`/`u` 规则降级为纯文本，`del|s|strike` → `~~`。
- `relativizeWlattach(html)` 把 `wlattach://attachments/` 替换为 `attachments/`；`meetingToMarkdown(meeting,tagNames)`（元信息头 + `---` + 正文，压缩连续空行）；`meetingExportFileName(m)` = `<date>_<清理后的标题>.md`。

### preload/index.ts（262 行）
`contextBridge.exposeInMainWorld('api', api)`，导出类型 `WorkLogApi`（42 个方法）。
- 一对一 `ipcRenderer.invoke` 映射：`storage:root`、`tasks:read|readMany|listDates|create|update|delete|trash|reorder|datesOf|postpone|publish`、`tags:*`、`trash:list|clear|remove|restore`、`history:trash|list|delete`、`weekly:info|read|write|shift`、`settings:get|set`、`search:tasks`、`stats:range`、`holiday:fetch`、`export:md`、`backup:export|import`、`sync:push|pull|localMtime`、`attach:saveImage|pickFile|open|delete`、`meetings:list|save|delete|export`、`sticky:list|add|update|delete`、`app:getInfo`、`update:check|download|install|set-source`、`report:exportMd|exportWord`。
- 组合封装：`saveMeetingAttachment(meetingId,name,buf)` → 复用 `attach:saveImage`，folder 传 `` `meetings/${meetingId}` ``（:207-208）。
- 唯一订阅型 API：`onUpdateEvent(cb): () => void`（`update:event`，返回取消订阅闭包）。
- 注意：`ipcRenderer.invoke` 参数未做运行期校验（如 `attach:saveImage` 的 `folder` 直通主进程拼接路径）。

## 3. 关键不变量与易踩坑点

### 3.1 区间派发 / 延期：同一 task id 跨多天共享状态
- `publishTasks`（tasks.ts:204-238）生成**一个** UUID，把同一条 task（含同一 `subtasks[].id`）写入每个目标日期，每天用各自的 `maxOrder+1`（tasks.ts:233-234）。返回 `instances: {date,taskId}[]`，`index.ts:254-263` 据此写 `publish-history.json`。
- `postponeTask`（:259-280）**只追加**：先 `datesOfTask` 取已有日期集合，重叠日期跳过；仅未完成任务可延期（`task.done` → `{ok:false,added:0}`）；新区间同样是同 id 复制。
- 同步的唯一实现是 `updateTask`（:81-117）：先在传入 `date` 上找任务并应用 patch（`done` 会写/清 `completedAt`，:93-98），然后 `datesOfTask(root, taskId)` 遍历所有日期，**逐天** `readTasks` → 用 `{...task, order: 当天原 order}` 替换同 id 项 → 逐天 `writeTasks`（:105-115）。`order` 是**唯一按天独立**的字段，其余字段全局共享。
- 因此 `note`（日报备注）也是共享的——在任意一天写备注，所有天都会变。
- 跨天同步的负责函数：`updateTask`（写）、`datesOfTask`（定位，:120-128）、`deleteTask`（删，:130-147，**忽略其 `date` 参数**，完全依赖 `datesOfTask` 扫描）。
- 性能特征：任一次编辑 = `listDatesWithTasks`（读目录树）+ 全量 `readTasks` 扫描 + 命中天重写；复杂度 O(总天数 × 文件 IO)。

### 3.2 删除任务为何牵动多天 / trash 快照格式
- 单个任务：`index.ts:218-235` 先 `datesOfTask` 收集全部日期的 task 拷贝 → 组成**一个** `TrashItem`（`tasks: TrashedTask[]`）→ `addTrashItem` → `deleteTask` 删除所有天。
- 发布历史整批：`index.ts:299-330` 遍历 `rec.instances`，用 `seenTaskIds` 去重后对每个 id 走 `datesOfTask`，汇集所有实例进一条 `TrashItem`，再逐 id `deleteTask`，最后 `deletePublishRecord`。
- 快照格式：`TrashItem { id, title, deletedAt, tasks: [{ date, task }] }`（`shared/types.ts:150-162`）。**恢复是"重放"而非"还原"**：`restoreTasksToDays`（tasks.ts:241-251）把每条 task 追加到其 `date` 文件末尾并重新分配 `order = maxOrder+1`，**原 order 与位置丢失**；`takeTrashItem` 取出即从回收站移除（失败即丢失）。恢复不检查该 id 是否已存在（重复恢复不会因 id 冲突被拦截，`deleteTask`/`datesOfTask` 又按 id 匹配，可能出现同 id 重复项）。
- `trash.json` 无任何容量上限/自动清理，永久增长。

### 3.3 migrate.ts 的历史迁移
- 标记：`<R>/.migrated-v1.2`（内容是迁移时间 ISO）。`migrateLegacyData` 在 `index.ts:190` 于 `whenReady` 中、注册 IPC 之前执行。
- 三个迁移见 §2。易踩坑：
  - `resetMigration` 之后**不会**清理 `weekly/<key>__<project>.json`，重跑时旧文件仍在；同样 `migratePublishHistory` 里 `instances.push(...)`（:167）是在 `continue` 判空之前对**已有实例**的数组操作——旧记录若已有实例会走 `continue` 不受影响，但实例数组来自 JSON 且被就地修改后整表重写。
  - `migrateStorageRoot`（storage.ts:51）在目标目录**非空**时直接返回：若新目录已产生任何内容（例如用户先手动创建过一个空文件夹不算、但要已有文件），旧的 `pre-update-backup/logs` 会被永久搁置且不报错。
  - 迁移期间无锁、无备份，损坏文件会被静默跳过（`migrateTags`/`migrateWeeklyFiles` 的 `catch` 均 `return`）。

### 3.4 backup / sync 的覆盖范围
- 备份 = **整个 R 递归**（含 `tasks` 天文件、`tags.json`、`trash.json`、`publish-history.json`、`settings.json`（**含 WebDAV 明文密码**）、`stickyNotes.json`、`weekly/`、`meetings/`、`attachments/`、`.migrated-v1.2`）。
- **不参与**：`%APPDATA%/WorkLog/pre-update-backup/`（R 的兄弟目录）、`%TEMP%/worklog-update/`（更新包与 `state.json`）、应用外的 `out/`、`dist/`、日志。
- `importBackup` 是**合并覆盖**，不删除本地独有文件；导入后 `index.ts:541` 调 `resetMigration`，下次启动（或本次重启后）重跑迁移使旧格式升级。
- `webdavPull` 同样合并 + `resetMigration`，**没有冲突检测/版本比较**，`syncWithResult` 只用 `lastDataMtime` 给 UI 提供本地 mtime（index.ts:590），主进程不做比对。
- `lastDataMtime` 检测范围（sync.ts:18-47）：R 的一级文件 + 一级子目录内的**直接文件**（不递归）。因此 `attachments/meetings/<id>/x.png`（三级）等更深文件的时间**不计入**。

### 3.5 storage.ts 规则
- 根目录：打包 → `app.getPath('appData')/WorkLog/logs`；dev → `app.getAppPath()/logs`（即仓库根 `logs/`）。数据**不可**放安装目录（NSIS 更新会 `RMDir /r`），由 `build/nsis-preserve-logs.nsh` 预备份。
- ISO 周：周一为起点；周序用**周四**所在 ISO 年计算：`dayOfYear = floor((thursday - new Date(isoYear,0,1))/86400000)`，`week = floor(dayOfYear/7)+1`（storage.ts:93-118）。`weekKey = YYYY-Www`（补零到 2 位，故 W53 之后无 W54）。
- `weekKeyToDates` 以「1 月 4 日必在第 1 周」反推周一（:121-141）。`getWeekInfoByKey` 实现为 `getWeekInfo(weekKeyToDates(k)[0])` —— 对同一 weekKey 是自洽的。
- 全部日期字符串均按**本地时区**解析（`new Date(dateStr + 'T00:00:00')`），无 UTC 归一；跨时区/夏令时（本应用面向 Windows 本地）风险低但存在。
- 渲染层有一份**并行实现** `src/renderer/src/utils/date.ts`（`toDateStr/weekInfoOf/weekdayOf/enumerateDates`），与主进程逻辑必须手工保持一致（注释已声明"与主进程保持一致"，但无测试保障）。

### 3.6 attachments 的 `wlattach://` 格式与校验
- 生成：`wlattach://attachments/<folder>/<encodeURIComponent(文件名)>`（attachments.ts:20-22）。URL 解析后 `hostname='attachments'`、`pathname='/<folder>/<file>'`（已用 Node 实测），拼回 `attachments/<folder>/<file>`。
- 校验只做 `path.resolve` 后的**前缀字符串比较** `full.startsWith(path.join(R,'attachments') + path.sep)`（:60-61）。`path.resolve` 会归一化 `..`，故 `attachments/../../x` 会被拦下；但：
  - `folder` 参数**从不校验**（`saveAttachmentBuffer`/`importAttachmentFile` 直接 `path.join(R,'attachments',folder)`，:32/:46）——渲染层若传 `../../`，文件会写到 R 之外；`wlattach://attachments/../../x` 反而会被读取校验拦住，形成**写/读不对称**。
  - 前缀比较对大小写不敏感的文件系统（Windows）不做大小写归一，`R` 内若存在 `Attachments` 目录不会被识别（仅影响判断，不构成穿越）。
  - `sanitizeName` 未过滤 `..`/`.`，纯 `..` 会被 `basename` 保留；不过名字带 `${Date.now()}_` 前缀，实际无法形成纯 `..`。
- `protocol.registerSchemesAsPrivileged` 在模块顶层、`app ready` 前调用并有 `typeof protocol !== 'undefined'` 保护（index.ts:67-74）；`protocol.handle('wlattach')` 在 `whenReady` 内注册（:193-197），路径非法时返回 403。

### 3.7 updater 双镜像流程与 IPC 事件
- 源选择：`settings.json:updateSource`（`auto|gitee|github`）。`auto` = Gitee 优先、异常或无更新时回退 GitHub；单源出错直接抛错（updater.ts:326-359）。`resolveUpdatePlan` **在 check 与 download 各执行一次**（:373、:395），两次之间远端可变化。
- Gitee：`/repos/{o}/{r}/releases/latest` → `/releases/{id}/attach_files` → 下载 `latest.yml`（带 `access_token` 查询参数）→ 比对版本 → 按附件名匹配安装包 → 附件 download 直链。缺 `latest.yml` 或安装包即抛错；HTTP 404 视为"无更新"。
- GitHub：`api.github.com/repos/{o}/{r}/releases/latest`（有 token 才加 `Authorization: Bearer`）→ 下载 `latest.yml` asset → 安装包取 `browser_download_url`。
- 下载：`streamDownload` 分块写文件并同步算 sha512，`content-length` 存在时广播 `progress`（0-100）；与 `latest.yml` 的 `sha512` 不符则删文件并报错（:407-410）。
- 状态与安装：`state.json` 写入 `%TEMP%/worklog-update`；`installUpdate` 用 `spawn(installer, ['--updated','--force-run'], {detached:true, stdio:'ignore'})` 后 `app.exit(0)`（无签名校验、无回滚）。
- IPC：四个 handle `update:check|download|install|set-source`（index.ts:567-573）；事件仅一条通道 `update:event`，payload `{channel,payload}`，内层 channel 见 §2 updater。开发模式（`!app.isPackaged`）直接拒绝 check/download。

### 3.8 tray 提醒调度
- `setInterval(..., 30000)`：每次 tick 都 `readSettings`（磁盘 IO），拿到 `HH:MM` 与当前本地时间比对；命中则 `lastFired = today` 去重（tray.ts:107-121）。
- 命中窗口依赖 30 秒采样：`HH:MM` 恰好在某次 tick 被观察到即可；若勾选设置在 `HH:MM` 之后开启，当天不再提醒（`lastFired` 仅记录提醒过的日期，切换时间会立即生效）。
- `lastFired` 是模块级变量，`startReminder` 只由 `index.ts:550` 调用一次；不存在重复定时器风险，但也不可停止/重配置。
- 关闭窗口 = 隐藏到托盘（`index.ts:116-121`），真正退出走托盘菜单；`app.quit()` 前 `isQuitting` 由第二个 `before-quit` 监听器置位（:664-666）。

## 4. 代码质量观察

**性能 / N 次文件读写**

1. `tasks.ts:120-128` `datesOfTask` = `listDatesWithTasks` + 对**每个日期** `readTasks`（全量 JSON 解析），每次任务编辑/删除都触发；`updateTask:106` 紧接着又对命中日期各 `readTasks` 一次，重复解析。
2. `tasks.ts:283-303` `removeTagFromAllTasks`：读全部日文件、全部解析，只为删一个标签引用；`tags.ts:30-43` `countTagUsage` 与 `tags.ts:45-51` `listTags` 每次都做同样的全量扫描（打开标签页即 O(天数) IO）。
3. `search.ts:24-65` 每个查询都全量读盘（无索引、无缓存），且 `listDatesWithTasks` 先读一遍目录再逐个读文件；50 条上限是**先 push 后裁剪**，仍会扫描完所有日期。
4. `stats.ts:25-41` 逐日 `readTasks`，区间选一年即 365 次文件读；`exporter.ts:81-108`/`:111-131` 同样逐日读盘（周报 7 次、区间导出可达数百次）。
5. `meetings.ts:60-77` `saveMeeting` **每次保存**都遍历目录并解析所有 `.md.json` 来找同 id 旧文件；`deleteMeeting:90-101`、`listMeetings:37-46` 同样全量解析——会议数增长后写放大明显。
6. `sync.ts:18-47` `lastDataMtime` 对每个一级子目录再 `readdir`+`stat`；虽只两级，但 `attachments/` 下文件多时仍是成百次 `stat`，且时机在每次 `sync:localMtime` 调用时。
7. `tray.ts:108-121` 每 30 秒同步读一次 `settings.json`（无缓存），长期运行持续 IO。
8. `updater.ts:139-181` 流式下载正确背压（`drain`），但无超时/取消机制；`net.fetch` 无 AbortSignal，网络卡住会一直挂起且无 UI 取消入口。

**重复实现 / 耦合**

9. `storage.ts:93-118` 与 `src/renderer/src/utils/date.ts` 双份 ISO 周实现（另有 `report.ts:2` 引用渲染层版本），无共享模块或测试，容易漂移。
10. `readJson/writeJson` 私有副本至少 3 处：`meta.ts:27-39`、`stickyNotes.ts:11-23`，另有各模块自写的 read/write 对（`trash.ts:19-22`、`history.ts:23-26`、`weekly.ts:31-43`、`tags.ts:24-27`、`tasks.ts:39-47`），`JSON.stringify(...,null,2)` 与 `mkdir(recursive)` 样板重复约 8 次。
11. `index.ts:299-330`（历史整批回收）与 `index.ts:218-235`（单任务回收）逻辑高度相似；`index.ts:474-507`、`:624-639`、`:642-657`、`:450-471` 四段"SaveDialog + writeFile + try/catch"几乎逐字重复，可抽一个 `saveWithDialog` 助手。
12. `backup.ts:13-29` `addDirToZip` 与 `storage.ts:34-43` `copyDirRecursive`、`backup.ts:44-57` `mergeDirs` 三个递归目录遍历各自实现。
13. `index.ts` 单文件 670 行承担全部 IPC 路由 + 业务编排（回收站组装、发布历史、自动同步调度、更新、导出），与 `main/*.ts` 领域模块边界模糊：如"回收站条目如何组装"仅存在于 IPC 层，无法被其它模块复用或单元测试。
14. `migrate.ts:77`/`:122` 硬编码 `weekly/` 与 `publish-history.json` 路径，未复用 `weeklyPath`/`historyPath`，重命名路径时会漏改。

**正确性 / 错误处理薄弱**

15. **写盘无原子性**：全部模块都是直接 `fs.writeFile` 覆盖（如 `tasks.ts:46`、`tags.ts:26`、`trash.json:21`），无临时文件 + rename、无 fsync；进程崩溃/断电可留下截断 JSON，而 `readTasks` 等**静默返回 `[]`**（`tasks.ts:34-36`、`tags.ts:19-21`、`trash.ts:14-16`），损坏数据会被当成"空"并被下一次写入**永久覆盖**——这是本项目最高风险项。
16. **并发写竞态**：仅 `stickyNotes.ts:26-32` 有串行锁；`tasks.ts`/`tags.ts`/`trash.ts` 无锁，而渲染层可并发 invoke（例如快速连点勾选 + 标签删除联动 `removeTagFromAllTasks` 都读改写同一批天文件），存在经典 read-modify-write 丢更新。
17. `tasks.ts:39-47` 空数组即**删除天文件**（含 last task 被删/移走的情形），配合 `readTasks` 静默失败，无法区分"当天无任务"与"文件损坏"。
18. `tasks.ts:81-117` `updateTask` 接受 `Partial<Task>`（index.ts:211 直接透传渲染层 `Partial<Task>`，比声明的 `TaskPatch` 更宽），`completedAt` 可被任意覆盖；`done` 与显式 `completedAt` 同时到达时后者胜出（:102 在 :93-98 之后无条件覆盖），语义未定义。
19. `attachments.ts:31-36`/`:45-50` 的 `folder` 未做任何校验（见 §3.6），是路径穿越的写入面；`sanitizeName` 也未处理 `.`/`..` 与超长文件名/保留设备名（Windows `CON`、`NUL` 等）。
20. `search.ts:61-63`：`hits.splice(0, hits.length - 50)` 在 `hits.length >= 50` 时恒等于**移除 0 个元素的空操作**（注释意图是裁剪），随后 `:67 hits.reverse()` 又反转整个已累积列表（可达全库命中数），最后 `:68 slice(0,50)`——意图应是在满 50 时 `break`，现实现既有语义歧义又有内存/性能浪费。
21. `search.ts:27` 用正则 `/<[^>]+>/g` 去 HTML 标签，正文含 `<`/`>`（代码片段、数学式）时会被误删，导致搜不到或 snippet 错位。
22. `stats.ts:36-40` 只统计 `t.tags`，**忽略子任务标签**；而 `tags.ts:36-39` 的 `useCount` 统计子任务标签——同一"标签用量"概念两处口径不一致。且 `totalTasks += taskCount` 会把区间共享任务的**每天副本**重复计数（一周发布会算 7 次）。
23. `history.ts:29-33` / `trash.ts:29-33` 的 `unshift` + 全量重写无上限；`trash.json` 与 `publish-history.json` 会随使用无限增长，且每次操作都要解析/序列化整个文件。
24. `meetings.ts:43-45`/`:98-100` 读取失败仅 `console.error` 后继续；`listMeetings` 静默丢弃坏文件，用户无感知（与 §15 同类问题）。
25. `meta.ts:41-61` `readSettings` 对嵌套 `webdav` 逐字段兜底但**不做类型校验**：若 JSON 中 `webdav` 是字符串，`s.webdav?.enabled` 取到 `undefined` 而回退默认，尚可；但 `s.reminder.time` 若为数字会被原样写入并传给 `tray.ts:114` 比较，永远不匹配（静默失效）。
26. `updater.ts:99-102` `parseTagVersion` 只接受标准 semver；`updater.ts:242`/`:307` 在 `latest.yml` 缺 `version` 时回退 tag，二者皆无效则 `isNewer` 抛"版本号无效"，用户看到的是报错而非"无更新"。`updater-config.ts:16` 明文 token 入库并随包分发（注释已自认，属已知取舍）。
27. `updater-config.ts` 依赖"Gitee 段写在 GitHub 段之前"这一**注释约定**供发布脚本解析，属脆弱的隐式契约。
28. `index.ts:348-352` `settings:set` 只处理 `updateSource`，WebDAV 的 `autoMode`/`intervalMinutes` 变更**不会重建定时器**（`scheduleAutoSync` 在 `:593-606` 只启动一次，`setInterval` 闭包捕获旧 settings），修改间隔需重启应用。
29. `index.ts:610-621` `before-quit` 内 `await readSettings` 后再 `e.preventDefault()`：异步间隙内其它 `before-quit` 监听器（`:664`）已把 `isQuitting` 置位，且 `exitPushed` 一次性标志使第二次退出不再上传——退出上传存在丢同步窗口。
30. `index.ts:590` `sync:localMtime` 返回的 mtime 仅被 UI 使用，主进程没有"拉取前比对本地 mtime / 备份远端"的保护，`webdavPull` 的合并覆盖可能静默覆盖本地较新文件（§3.4）。
31. `storage.ts:51-77` `migrateStorageRoot` 的 `cleanup` 会在复制成功后 `fs.rm` 源目录；若 `copyDirRecursive` 部分成功（异常前已复制部分文件）则会走 `catch` 继续下一个源，但已复制内容留在目标——下一次启动因目标非空而**直接跳过**，留下半迁移状态。
32. `backup.ts:32-42` `importBackup` 注释写"解压到临时目录后合并"，但未校验 zip 内路径（`zip.extractAllTo` 对含 `..` 的条目行为依赖 adm-zip 实现），恶意/损坏备份存在写到 R 之外的风险。
33. `tray.ts:104` `lastFired` 为模块级状态，若 `startReminder` 被重复调用（未来重构）会叠加多份 `setInterval`，无清理句柄返回。

**其它观察**

34. `index.ts:180-181` 用 `disk-cache-size=0` / `disable-gpu-shader-disk-cache` 规避缓存目录问题，属环境适配型 hack，注释已说明动机。
35. 天文件按年份分目录，但**目录名取 `date.slice(0,4)`**（`tasks.ts:8`），与 `listDatesWithTasks`（`tasks.ts:172-179`）只认一级目录 + `^\d{4}-\d{2}-\d{2}\.json$` 一致；若将来出现非年份子目录（如 `attachments`）其下文件不会误匹配（正则限定了文件名形态），安全。
36. 本次调研时工作树已存在他人未提交改动（`git status` 显示 `src/main/{exporter,index,meta}.ts`、`src/preload/index.ts`、多个 renderer 文件为 `M`，`pnpm-lock.yaml` 未跟踪），本档案基于**当前工作树内容**，行号可能与 HEAD 不一致。

---

**一句话总结**：主进程是"无数据库、纯 JSON 文件系统"的设计，天文件按 `YYYY/<date>.json` 分片，跨天共享靠**同一 task id 的多份副本 + `updateTask`/`datesOfTask` 全库扫描同步**；最大风险是**写盘无原子性 + 读失败静默当空**，最大性能瓶颈是 **5 个模块对全量天文件做 O(天数) 读盘**（`datesOfTask`、`countTagUsage`、`searchTasks`、`rangeStats`、`removeTagFromAllTasks`）。
