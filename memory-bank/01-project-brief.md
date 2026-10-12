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

## 已评估并否决的方向（避免重复讨论）

### 登录注册 / 账号体系 —— 2026-10-10 评估后**否决**

- **起因**：想「在别的电脑上使用这个系统」，原本考虑加登录注册 + 邮箱绑定 + MySQL。
- **结论：不做了。理由是一个概念纠偏** —— 这个需求是**多设备**问题，不是**多用户**问题。
  单人多设备只需要「同步」，而**同步功能软件里已经有了**（WebDAV：一键上传/下载、启动拉取/退出上传/定时、下载前冲突提示），
  注册一个坚果云（免费版每月上传 1GB / 下载 3GB）即可在第二台电脑上使用，**零开发、零成本**。
- **用户决定**：「那登录功能先取消吧」。**没有产生任何代码改动。**
- **若将来真要给他人使用**（那时账号才有真实价值），架构已被确认，**不要重新论证**：
  1. **红线：Electron 客户端绝不直连 MySQL。** 数据库地址与凭据必须打包进安装包，而 asar 是明文归档
     （本项目已实测可用 `@electron/asar` 直接读出内容）→ 泄露即可拖库删库。数据库**只能待在后端服务后面**。
  2. 正确形态：`Electron 客户端 ──HTTPS──▶ 后端 API ──▶ MySQL`，客户端只持有 token。
  3. **不买服务器也能做**：让本机当服务端 + [Tailscale](https://tailscale.com/pricing) 个人版组网
     （免费、**无限设备**、最多 6 用户），笔记本通过虚拟内网 IP 访问；不需要公网 IP / 域名 / 备案 / HTTPS 证书。
     代价是本机需常开。
  4. 后端选型（用户已选定，可直接沿用）：**Node + TypeScript + Fastify + Prisma**（与现有 TS 栈一致，可复用
     `src/shared/types.ts`）；邮箱验证码开发阶段先打印到后端日志，上线前再替换发送器。
  5. 「把数据从 JSON 搬进数据库」是独立的后继工程，且**必须保留跨天共享任务的不变量**
     （同一 `task.id` 多天副本、`order` 按天独立），关系型建模需要 `tasks` + `task_dates` 关联表。

### 本机开发环境实测（2026-10-10，供将来后端/数据库开发直接用）

| 项 | 状态 |
|---|---|
| MySQL | ✅ **8.0.45 Community Server 已装且运行中**（服务 `MySQL80`；`3306` + `33060`；InnoDB） |
| MySQL 路径 | `C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe`（**未加入 PATH**）；`root` 已有密码 |
| Docker / WSL | ❌ Docker 未装；WSL 无可用发行版 |
| Node / npm / git | ✅ v24.14.0 / 11.9.0 / 2.50.1 |
| 图形客户端 | ❌ 未装 Workbench / DBeaver（可选装，便于调试 SQL） |
| 访问 GitHub | ⚠️ 需 **Steam++ 加速器**；大文件下载经加速器不稳定（详见 [05](05-progress.md) §6） |

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
