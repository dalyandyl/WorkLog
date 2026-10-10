# 01 项目概况（Project Brief）

> 本文件回答「这是什么、给谁用、怎么跑」。技术细节见 [02-architecture.md](02-architecture.md)，数据结构见 [03-data-model.md](03-data-model.md)。

## 一句话定位

**日志工具（WorkLog）** —— 面向个人（作者本人 LHQ）的 Windows 桌面工作日志工具：以「任务清单」为核心记录每天 / 每周工作，支持彩色标签、富文本正文、任务发布与周报汇总，可导出 Markdown / Word，并内置 WebDAV 跨设备同步与双镜像自动更新。

## 目标与取舍

| 维度 | 选择 | 原因 |
|---|---|---|
| 用户 | 单用户、本机私用 | 无账号体系、无服务端 |
| 数据 | **本地明文 JSON 文件**（无数据库） | 可直接用文件管理器查看/备份/手改；不上云 |
| 部署 | 自打包 NSIS 安装包 + 自研更新器 | 不依赖代码签名与商店 |
| 分发 | Gitee 主源 + GitHub 镜像 | 国内下载速度；**Gitee 发行版附件上限 100MB**，是体积优化的硬约束 |
| 界面 | 中文单页应用，左侧竖排导航 | 单窗口，无路由库 |

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面容器 | Electron 44 |
| 构建 | electron-vite 5 + Vite 7（`externalizeDepsPlugin` 用于主进程 / preload） |
| 渲染层 | React 19 + TypeScript 7（`strict: true`） |
| 富文本 | TipTap 3（`@tiptap/*`、`@tiptap/pm`）+ lowlight/highlight.js（代码高亮） |
| Markdown | markdown-it（渲染）、turndown + gfm 插件（HTML→MD，主进程导出用） |
| 公式 | KaTeX（**动态 import**，仅在正文含公式时加载） |
| 图标 / 字体 | lucide-react、Inter、JetBrains Mono（`@fontsource/*`） |
| 打包 | electron-builder 26（NSIS、`compression: maximum`、`afterPack` 裁剪） |
| 压缩 / 配置 | adm-zip（备份 zip）、js-yaml（解析 latest.yml）、semver（版本比较） |

> **依赖归属有硬约束**：主进程运行时真正 `require` 的只有 `adm-zip` / `js-yaml` / `semver` / `turndown` / `turndown-plugin-gfm`。`@tiptap/*`、`lowlight` 等**仅渲染层使用**的包若留在 `dependencies`，会被 electron-builder 原样打进 `app.asar`（约 13MB 冗余，其中 highlight.js 单包 5.16MB）。详见 [07-optimization-backlog.md](07-optimization-backlog.md)。

## 环境要求

- Windows 10/11 64 位
- Node.js 18+（仅开发/源码运行需要；安装打包版不需要）
- 包管理器：`npm`（`.npmrc` 只放注释；Electron 二进制镜像由环境变量 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` 提供，一次性执行 `scripts/set-mirrors.ps1`）

## 常用命令

```bash
npm install              # 首次安装依赖（若曾用 --ignore-scripts，需补跑 npm rebuild electron）
npm run dev              # 开发模式（自动开窗 + 热更新）；大版本更新后建议完全退出再重启
npm run build            # 构建产物到 out/（约 3.15MB）
npm run typecheck        # tsc --noEmit 分别检查 node 侧与 web 侧（提交前必跑）
npm run dist             # 构建 + 打包 Windows 安装包到 dist/
npm run publish:gitee    # 构建 + 打包 + 发布到 Gitee（软件内更新主源）
npm run publish:github   # 构建 + 打包 + 发布到 GitHub（镜像源）
```

- `npm run dev` / `preview` 实际走 `scripts/electron-vite.cjs`，作用是**清除 `ELECTRON_RUN_AS_NODE`**——某些桌面工具链会注入该变量，使 electron.exe 退化为纯 Node 模式、`require('electron').app` 为 undefined 而启动即崩。
- 发布脚本会读取 `CHANGELOG.md` 中与 `package.json` 版本号匹配的章节作为 Release 备注；同时需手工把同样内容追加到 `src/renderer/src/data/releaseNotes.ts`（应用内「更新公告」页）。

## 仓库与版本

| 远端 | 地址 | 角色 |
|---|---|---|
| `origin` | https://gitee.com/dadalia1/worklog.git | 主源（发布 + 更新） |
| `github` | https://github.com/dalyandyl/WorkLog.git | 镜像源 |

- 版本号在 `package.json.version`（当前 **1.5.3**），语义化为 `x.y.z`（可带 `-beta`）；**版本号必须高于已安装版本才会提示更新**。
- 安装包未做代码签名，Windows SmartScreen 警告属预期行为。
- Git 工作分支为 `master`。

## 存储位置（重要）

| 场景 | 日志数据根目录 |
|---|---|
| 开发（`npm run dev`） | `<项目目录>/logs` |
| 打包安装后 | `%APPDATA%/WorkLog/logs` |

数据**绝不能**放在安装目录：NSIS 更新时旧版卸载器会 `RMDir /r $INSTDIR` 连带删除。为此 `build/nsis-preserve-logs.nsh` 会在更新前把 `<安装目录>/logs` 备份到 `%APPDATA%/WorkLog/pre-update-backup/logs`，新版启动时由 `migrateStorageRoot()` 迁回。

## 功能全景（一句话版）

日报 / 周报 / 任务发布（批量 + 区间 + 延期）/ 便签 / 会议纪要 / 统计 / 报表（MD + Word 导出）/ 标签库 / 全局搜索 / 临时回收站 / 发布历史 / 日历（联网节假日）/ 数据备份导入导出 / WebDAV 同步 / 双镜像自动更新 / 更新公告。

逐功能到代码的映射见 [04-features.md](04-features.md)。
