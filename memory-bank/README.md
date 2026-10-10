# 记忆库（Memory Bank）· 日志工具 WorkLog

> **用途**：跨对话保留项目知识，避免每次都重新调研。
> **建立时间**：2026-10-10 ｜ **对应代码版本**：`package.json` = 1.5.3（工作树含未提交的 1.5.4 在制品）
> **入口**：新会话请**先读根级 [`../AGENTS.md`](../AGENTS.md)**，它会在首次请求时自动加载并指向本目录。

## 怎么用

| 你的任务 | 先读 |
|---|---|
| 不熟悉项目 / 想清点家底 | [01-project-brief.md](01-project-brief.md) |
| 要改代码（任何改动） | [AGENTS.md](../AGENTS.md) 的「铁律」→ [06-conventions.md](06-conventions.md) |
| 碰数据 / 存储 / 备份 / 迁移 | [03-data-model.md](03-data-model.md) |
| 加功能、找某功能在哪 | [04-features.md](04-features.md) |
| 想知道做到哪了、下一步做什么 | [05-progress.md](05-progress.md) |
| 做优化 / 性能 / 体积 | [07-optimization-backlog.md](07-optimization-backlog.md) |
| 需要精确的模块签名与 file:line | 附录（见下） |
| 恢复上一次会话的上下文 | [session-log.md](session-log.md) 最近 2–3 条 |

## 文件清单

| 文件 | 内容 | 稳定性 |
|---|---|---|
| [`01-project-brief.md`](01-project-brief.md) | 定位、目标用户、技术栈、命令、仓库与版本、存储位置 | 稳定 |
| [`02-architecture.md`](02-architecture.md) | 三进程结构、**IPC 通道全表**、主进程模块速查、渲染层结构与数据流约定、构建打包、**安全边界**、环境适配的「坑」清单 | 稳定 |
| [`03-data-model.md`](03-data-model.md) | 存储根解析、**磁盘文件清单与 JSON 结构**、核心类型、**头号不变量：区间共享任务**、回收站「重放」语义、迁移、备份/同步覆盖范围、时间约定 | 稳定 |
| [`04-features.md`](04-features.md) | 18 个功能 → 入口组件 / 主进程模块 / IPC / 数据文件 / 关键行为 / 已知问题；含「已移除的功能」防误找 | 随功能变化 |
| [`05-progress.md`](05-progress.md) | 当前状态快照、版本历史、**在制品明细与收尾清单**、后续路线 | **每轮必更** |
| [`06-conventions.md`](06-conventions.md) | 代码/类型/样式/渲染层约定、**新增 IPC 与新增功能的改动清单**、数据层铁律、验证与发布流程、文档维护对照表 | 稳定 |
| [`07-optimization-backlog.md`](07-optimization-backlog.md) | 分级优化待办（P0–P3），每条含证据 file:line / 影响 / 方案 / 工作量 / 验证方式 + 建议执行顺序 | 随优化推进 |
| [`session-log.md`](session-log.md) | 追加式会话日志 | **每轮必更** |
| [`appendix-main-process.md`](appendix-main-process.md) | 主进程深度档案：21 个模块的导出签名、36 条带 file:line 的质量观察 | **快照**（2026-10-10） |
| [`appendix-renderer.md`](appendix-renderer.md) | 渲染层深度档案：27 个组件逐一说明、main.css 37 个分区清单、16 个 CSS 变量表、刷新矩阵 | **快照**（2026-10-10） |

## 关于两份附录

附录是**一次性只读调研的原始产物**，价值在于精确到 `file:line` 的细节（模块签名、组件 API 调用点、CSS 分区行号）。

⚠️ **它们的行号基于 2026-10-10 的工作树快照**，代码变动后会逐步失准。使用原则：

- 需要**精确定位**某函数 / 某字段时查附录，但**用 grep 复核行号**；
- 结论性的知识以 `01`–`07` 为准（这些会持续维护），附录**不追着改**；
- 若附录与正文冲突，**以正文为准**，并顺手在 [session-log.md](session-log.md) 记一笔。

## 维护规则（重要）

**每次改动代码后必须更新记忆库**，否则下一个会话会读到过期的地图，比没有地图更危险。对照表见 [06-conventions.md](06-conventions.md) §8。最低要求：

1. 每轮工作结束，往 [session-log.md](session-log.md) **追加**一条（日期 / 做了什么 / 结论与决定 / 遗留）；
2. 功能或数据结构有变化时，更新 [04-features.md](04-features.md) / [03-data-model.md](03-data-model.md)；
3. 发布新版本时，更新 [05-progress.md](05-progress.md) 的版本历史与状态快照；
4. 修掉优化项时，把它从 [07-optimization-backlog.md](07-optimization-backlog.md) 移到该文件的「已完成」表。

## 约束

- **根级 `AGENTS.md` 必须保持精简**：DSH 在首次请求时把项目根的 `AGENTS.md`（以及从根到工作目录的每一级）注入上下文，**总预算 64KB**。因此详细内容一律放本目录，`AGENTS.md` 只做索引 + 铁律。
- 本目录文件用中文撰写，与代码注释语言一致。
- 本目录纳入 Git 跟踪（它不是构建产物），且不应包含任何令牌、密码或真实用户数据 —— `logs/` 已在 `.gitignore` 中。
