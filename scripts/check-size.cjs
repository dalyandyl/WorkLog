/**
 * 安装包体积守卫。
 *
 * 背景：Gitee 发行版附件上限 100MB，而 1.5.3 的安装包已到 98.99MB（余量 <1MB）。
 * 用法： npm run dist 之后执行 `npm run size`。
 *   - 超过硬上限（默认 98MB）→ 退出码 1，提示去排查 dependencies；
 *   - 同时列出 app.asar 内各包体积，便于定位"本不该进包"的依赖。
 *
 * 阈值可用环境变量覆盖： WORKLOG_MAX_MB=95
 */
const fs = require('fs')
const path = require('path')

/** Gitee 发行版附件硬上限（MB） */
const HARD_LIMIT_MB = 100
/** 触发失败的警戒线（MB）——留出余量，避免下次贴边 */
const MAX_MB = Number(process.env.WORKLOG_MAX_MB || 98)

const distDir = path.join(__dirname, '..', 'dist')

function mb(bytes) {
  return bytes / 1048576
}

function fmt(bytes) {
  return mb(bytes).toFixed(2) + ' MB'
}

if (!fs.existsSync(distDir)) {
  console.error('未找到 dist/ 目录 —— 请先执行 npm run dist')
  process.exit(1)
}

// ---- 1. 安装包体积 ----
const installers = fs
  .readdirSync(distDir)
  .filter((f) => /-setup\.exe$/.test(f))
  .map((f) => ({ name: f, size: fs.statSync(path.join(distDir, f)).size }))

if (installers.length === 0) {
  console.error('dist/ 下没有找到 *-setup.exe —— 请先执行 npm run dist')
  process.exit(1)
}

installers.sort((a, b) => b.size - a.size)

console.log('=== 安装包体积 ===')
for (const it of installers) {
  console.log(`  ${fmt(it.size).padStart(10)}  ${it.name}`)
}

// package.json 里的版本对应的那个安装包
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'))
const current = installers.find((f) => f.name === `worklog-${pkg.version}-setup.exe`)
const target = current || installers[0]
console.log(
  `\n当前版本 ${pkg.version} 的安装包：${target.name} = ${fmt(target.size)}` +
    (current ? '' : '（未找到同版本安装包，改用最大的一个判断）')
)

// ---- 2. app.asar 构成（可选，失败不影响判定）----
const asarPath = path.join(distDir, 'win-unpacked', 'resources', 'app.asar')
if (fs.existsSync(asarPath)) {
  const asarSize = fs.statSync(asarPath).size
  console.log(`\n=== app.asar 体积：${fmt(asarSize)} ===`)
  try {
    const asar = require('@electron/asar')
    const header = asar.getRawHeader(asarPath)
    const sizes = new Map()
    const walk = (node, prefix) => {
      if (!node.files) return
      for (const [name, child] of Object.entries(node.files)) {
        const p = prefix + '/' + name
        if (child.files) {
          walk(child, p)
        } else {
          const parts = p.split('/').filter(Boolean)
          const key =
            parts[0] === 'node_modules'
              ? parts[1] && parts[1].startsWith('@')
                ? parts[1] + '/' + parts[2]
                : parts[1]
              : parts[0]
          sizes.set(key, (sizes.get(key) || 0) + (child.size || 0))
        }
      }
    }
    walk(header.header, '')
    const rows = [...sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    for (const [k, v] of rows) {
      console.log(`  ${fmt(v).padStart(10)}  ${k}`)
    }
    // 渲染层专用依赖出现在 asar 里 = 本不该进包
    const LEAKED = ['highlight.js', '@tiptap/core', '@tiptap/pm', 'prosemirror-view', 'lowlight']
    const leaked = LEAKED.filter((n) => sizes.has(n))
    if (leaked.length > 0) {
      console.log(
        `\n⚠ 疑似渲染层专用依赖被打进 asar：${leaked.join(', ')}\n` +
          '  这些包应放在 devDependencies（它们已被 Vite 打包进 out/renderer）。\n' +
          '  详见 memory-bank/07-optimization-backlog.md P1-5。'
      )
    }
  } catch (err) {
    console.log('  （无法解析 asar 内容：' + err.message + '）')
  }
} else {
  console.log('\n（未找到 dist/win-unpacked/resources/app.asar，跳过构成分析）')
}

// ---- 3. 判定 ----
console.log('')
if (mb(target.size) > HARD_LIMIT_MB) {
  console.error(`✗ 失败：安装包 ${fmt(target.size)} 超过 Gitee 附件硬上限 ${HARD_LIMIT_MB}MB，无法发布。`)
  process.exit(1)
}
if (mb(target.size) > MAX_MB) {
  console.error(
    `✗ 失败：安装包 ${fmt(target.size)} 超过警戒线 ${MAX_MB}MB` +
      `（距硬上限 ${HARD_LIMIT_MB}MB 仅剩 ${(HARD_LIMIT_MB - mb(target.size)).toFixed(2)}MB）。\n` +
      '  请检查 src/main 是否新引入了依赖，或渲染层专用依赖是否误放 dependencies。'
  )
  process.exit(1)
}
console.log(`✓ 通过：${fmt(target.size)} ≤ ${MAX_MB}MB（硬上限 ${HARD_LIMIT_MB}MB）`)
