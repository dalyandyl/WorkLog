// electron-builder afterPack 钩子：打包后精简体积
// - 删除 Electron 多余语言包（仅保留 en-US / zh-CN），通常可省 10~20 MB
// - 删除未使用的 default_app.asar
// 目的：将 NSIS 安装包压到 Gitee 发行版附件 100MB 上限以内。
const fs = require('fs')
const path = require('path')

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir

  // 1) 语言包裁剪
  const localesDir = path.join(appOutDir, 'locales')
  if (fs.existsSync(localesDir)) {
    const keep = new Set(['en-US.pak', 'zh-CN.pak'])
    let removed = 0
    for (const f of fs.readdirSync(localesDir)) {
      if (!keep.has(f)) {
        fs.unlinkSync(path.join(localesDir, f))
        removed++
      }
    }
    console.log(`[after-pack] locales: removed ${removed} files, kept en-US/zh-CN`)
  }

  // 2) 默认应用资源
  const defaultAsar = path.join(appOutDir, 'resources', 'default_app.asar')
  if (fs.existsSync(defaultAsar)) {
    fs.unlinkSync(defaultAsar)
    console.log('[after-pack] removed default_app.asar')
  }
}
