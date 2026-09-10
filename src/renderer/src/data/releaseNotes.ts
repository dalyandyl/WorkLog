/**
 * 更新公告（内置打包数据）
 *
 * 维护方式：每次发布新版本时，把该版本的更新内容作为新条目加在数组最前面，
 * 与 CHANGELOG.md 保持一致（content 即该版本章节的 Markdown 正文）。
 * 版本号格式建议 `x.y.z`（可带 -beta 后缀）；日期为 `YYYY-MM-DD`。
 */
export interface ReleaseNote {
  version: string
  date?: string
  content: string
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.5.2',
    date: '2026-09-10',
    content: `- 恢复 GPU 硬件加速，修复按钮悬停、弹窗打开卡顿`
  },
  {
    version: '1.5.1',
    date: '2026-09-09',
    content: `- 新增「更新公告」页，展示每个版本发布的新内容
- 启动时自动检测新版本，右下角气泡提示（下载进度、重启安装）
- 全项目下拉列表统一为报表样式；左侧菜单分组可收起
- 日报任务勾框美化；取消主区底部状态栏
- 更新提示按钮颜色随主题强调色变化`
  }
]
