// electron-builder afterPack 钩子：打包后精简体积
// - 删除 Electron 多余语言包（仅保留 en-US / zh-CN），通常可省 10~20 MB
// - 删除未使用的 default_app.asar
// - 删除 LICENSES.chromium.html（约 19MB 纯许可文本，运行时不会被读取）
// - 删除 dxcompiler.dll / dxil.dll（WebGPU 专用，应用不使用 WebGPU，节省 ~20MB）
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

  // 3) Chromium 许可文本（chrome://credits 才用到，运行时无影响）
  const licensesHtml = path.join(appOutDir, 'LICENSES.chromium.html')
  if (fs.existsSync(licensesHtml)) {
    fs.unlinkSync(licensesHtml)
    console.log('[after-pack] removed LICENSES.chromium.html')
  }

  // 4) WebGPU 专用二进制（本应用不使用 WebGPU；删除后仅 WebGPU 相关 API 不可用）
  for (const name of ['dxcompiler.dll', 'dxil.dll']) {
    const p = path.join(appOutDir, name)
    if (fs.existsSync(p)) {
      fs.unlinkSync(p)
      console.log(`[after-pack] removed ${name}`)
    }
  }
}
