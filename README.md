# 日志工具（WorkLog）

个人日志管理工具：以「任务清单」为核心记录每天/每周工作，支持彩色标签、论坛式富文本正文（字体颜色/字号/下划线/公式/代码块/图片/多附件）、任务发布与周报汇总，可导出 Markdown / Word。

- 技术栈：Electron + Vite + React 19 + TypeScript + TipTap 3（富文本编辑器）+ KaTeX（数学公式）
- 运行平台：Windows 10/11（64 位）
- 数据存储：本地明文文件（任务 JSON + 正文 + 附件）。开发模式存于项目 `logs/`；打包安装后存于 `%APPDATA%/WorkLog/logs`（更新前自动备份迁移，防止清空）。

## 环境要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10/11 64 位 |
| Node.js | 18 及以上（仅开发/源码运行需要；安装打包版则不需要） |
| 包管理器 | npm（已配置国内镜像，见 `.npmrc`） |

## 在 VSCode 中运行

1. 用 VSCode 打开本文件夹（`D:\selfproject\worklog`）。
2. 在终端执行（首次安装依赖）：

   ```bash
   npm install
   ```

   > 如果之前已执行过 `npm install --ignore-scripts`（Electron 二进制未下载），
   > 请补跑一次：`npm rebuild electron`

3. 启动开发模式（自动打开应用窗口，带热更新）：

   ```bash
   npm run dev
   ```

   > 代码大版本更新后建议**完全退出应用进程再重启** dev，避免热更新残留状态。

4. 其它命令：

   ```bash
   npm run build        # 构建产物到 out/
   npm run typecheck    # TypeScript 类型检查
   npm run dist         # 打包 Windows 安装包（setup.exe 输出到 dist/）
   npm run publish:gitee    # 构建 + 打包 + 发布到 Gitee（软件内更新走此源）
   npm run publish:github   # 构建 + 打包 + 发布到 GitHub（镜像源）
   ```

## 功能总览

- **日报**（默认页签）：查看当天任务，显示**派发时间**与**完成时间**，可**勾选完成**；**默认只读**，点 ✏️ 图标进入**行内编辑模式**（可改标题/标签/子任务/正文/备注，💾 保存 / ✕ 取消，所有天同步），🗑 图标删除（区间派发到多天的任务，删除任一天会同步删除所有天，先进入临时回收站可恢复）。已完成任务标题**置灰 + 对勾**，无删除线、清晰可读。
- **任务发布**：批量多任务派发（待发布列表：逐条填加标题/标签/子任务/正文/单日或区间，最后统一发布）；区间派发**同一任务 id 共享多天**，任一天勾选完成/编辑/备注同步到所有天；未完成任务支持**延期**（在日报任务详情或发布页，追加自定义新区间，原区间保留、全区间同步，重叠日期自动跳过）；主界面含「已发布任务」与「发布历史」，**只读查看**（点击看详情），编辑/删除统一在日报完成。
- **发布历史**：按日/周/月/年**下拉筛选**并显示范围；点击记录查看详情（含任务实例）。
- **临时回收站**：删除的发布任务先进回收站，可整批恢复或永久删除、清空。
- **周报**：按周汇总任务，显示**派发/完成时间**；已完成任务置灰 + 对勾；周总结弹窗填写（纯 Markdown，自动保存）。
- **报表**：日/周/月/年**下拉粒度** + 范围显示；汇总+明细，明细显示**派发/完成时间与备注**；实时预览；导出 **Markdown / Word**（各有预览小眼睛，支持分别导出汇总/明细/汇总+明细）。
- **便签**：轻量「非紧急任务」提醒；置顶且未完成的便签显示在每天日报任务列表上方（可直接勾选完成、取消置顶），直到标记完成前日报都能看到；未置顶便签只在便签页查看；完成后保留可恢复；完整参与备份与 WebDAV 同步。
- **标签管理**：全局标签库，显示**创建时间**与**使用次数**；重名弹窗提示。
- **搜索**：全局搜索标题/正文/子任务/**标签名**。
- **跨设备同步**：内置 **WebDAV** 同步（如坚果云），一键上传/下载、可设**自动同步**（启动拉取/退出上传/定时）、显示最近同步时间、下载前**冲突提示**。
- **Markdown 正文**：纯 Markdown 源码编辑（无工具栏，仅图片/附件按钮，支持粘贴/拖拽图片）；**右键菜单**可快速加粗/删除线/插入代码块/列表。
- **日历**：按年联网同步法定节假日，手动刷新。
- **关于与更新**：系统信息 + 作者 LHQ + 检查更新（Gitee / GitHub **双镜像源**自动更新，可在设置中选择镜像源）。

> 旧版本的「项目结构层级」功能已整体取消；旧数据中的 projectId 字段保留但忽略，启动时自动迁移兼容旧任务。

## 目录结构

```
worklog/
├── src/
│   ├── shared/types.ts  # 三端共享类型
│   ├── main/            # Electron 主进程
│   │   ├── index.ts     # 窗口、IPC 路由、托盘/提醒接线、WebDAV 自动同步
│   │   ├── storage.ts   # 存储根目录、ISO 周/日期计算
│   │   ├── tasks.ts     # 任务 CRUD、排序、区间派发（共享状态）、跨天同步
│   │   ├── tags.ts      # 标签库 CRUD（联动）
│   │   ├── history.ts   # 发布历史
│   │   ├── weekly.ts    # 周报读写、weekKey 换算
│   │   ├── exporter.ts  # Markdown 导出内容生成
│   │   ├── meta.ts      # 休息日 + 应用设置
│   │   ├── stickyNotes.ts # 便签 CRUD（置顶便签显示在日报任务列表上方）
│   │   ├── search.ts    # 任务搜索（剥离 HTML）
│   │   ├── stats.ts     # 区间任务统计
│   │   ├── backup.ts    # 备份导入导出（zip）
│   │   ├── migrate.ts   # 旧版本数据一次性迁移
│   │   ├── sync.ts      # WebDAV 上传/下载、本地修改检测
│   │   ├── trash.ts     # 临时回收站
│   │   ├── attachments.ts  # 附件存储与 wlattach:// 解析
│   │   ├── updater.ts   # 自动更新（Gitee / GitHub 双通道：检测→下载→校验→安装）
│   │   ├── updater-config.ts        # 更新仓库/令牌配置（.gitignore 忽略）
│   │   ├── updater-config.example.ts # 配置模板
│   │   └── tray.ts      # 托盘 + 每日提醒
│   ├── preload/         # 安全桥接层
│   └── renderer/src/
│       ├── App.tsx              # 左侧导航（日报/周报/发布/统计/报表/标签/会议/回收站）+ 日历 + 设置
│       └── components/
│           ├── DayView.tsx      # 日报（卡片任务列表 + 详情两态 + 备注）
│           ├── TaskDetail.tsx   # 任务详情（只读 + 备注编辑）
│           ├── TaskPublish.tsx  # 任务发布（批量待发布列表）+ 发布历史
│           ├── WeeklyView.tsx   # 周报（周选择 + 汇总 + 周总结）
│           ├── MarkdownEditor.tsx  # 纯 Markdown 编辑（右键加粗/删除线/代码块/列表）
│           ├── ReportView.tsx   # 日志报表（粒度下拉 + Word/MD 导出 + 预览）
│           ├── StatsView.tsx    # 区间统计
│           ├── TagPicker.tsx / TagManager.tsx / TrashView.tsx
│           ├── StickyNotesView.tsx  # 便签管理页（新增/置顶/完成/编辑/删除）
│           ├── RichView.tsx / SearchBox.tsx / DatePicker.tsx
│           ├── Calendar.tsx / DropdownSelect.tsx / SettingsModal.tsx / Drawer.tsx / Modal.tsx
├── scripts/
│   ├── publish-gitee.ps1    # 发布到 Gitee 的自动化脚本
│   ├── publish-github.ps1   # 发布到 GitHub 的自动化脚本
│   └── after-pack.js        # 打包后精简体积（裁剪 Electron 语言包）
├── CHANGELOG.md        # 更新日志（自动作为 Release 发布备注）
├── electron.vite.config.ts
├── electron-builder.yml
└── package.json
```

## 自动更新（Gitee / GitHub 双镜像源）

应用内置自动更新：检测 → 下载 → sha512 校验 → 安装，支持 Gitee / GitHub 双镜像源，可在「设置 → 关于系统 → 更新镜像源」切换（自动 = Gitee 优先，失败回退 GitHub）。

发布新版本（两端同步）：
1. 升级 `package.json` 的 `version`，并在 `CHANGELOG.md` 顶部新增对应版本章节（自动作为 Release 说明）；
2. 执行 `npm run publish:gitee`、`npm run publish:github`（令牌：Gitee 填 `src/main/updater-config.ts`，GitHub 用环境变量 `GH_TOKEN`）；
3. 打标签并推送两端：`git tag -a v<版本> -m "说明"`。

> 版本号高于已安装版本才会提示更新；安装包未做代码签名，Windows SmartScreen 提示属正常。
