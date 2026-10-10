/**
 * `npm run ui:shot` —— 把渲染层在**没有主进程**的情况下跑起来并截图。
 *
 * 为什么需要它：本项目的界面改动长期只过 `typecheck` / `build`，**从没人看过画面**，
 * 而 agent 也无法操作真实窗口去点。有了它就能把任意页面渲染成 PNG，
 * 再用肉眼 / 像素分析来验证（"先测不猜"）。
 *
 * 用法：
 *   npm run ui:shot                          # 默认截「日志」页
 *   npm run ui:shot -- 任务                  # 截任意导航页（按左侧导航文字匹配）
 *   npm run ui:shot -- 会议 out/m.png 新建会议   # 切到该页后再点一个按钮（按文字匹配）
 *
 * 产物：
 *   out/ui-shot.png    截图
 *   out/ui-shot.json   页面结构自检 + 控制台日志 + 黄像素分析
 * （都写在 out/ 下，已被 .gitignore 忽略）
 *
 * 退出码：0 正常；非 0 表示夹具自身出错（页面没渲染出来也会带出结构信息）。
 */
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const http = require('http')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const RENDERER = path.join(ROOT, 'out', 'renderer')

const argv = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const WANT_VIEW = argv[0] || '日志'
/** 切到目标页后，再点一个按钮（按可见文字包含匹配），用于打开弹窗/编辑器 */
const CLICK_TEXT = argv[2] || ''
// 产物写进 out/（已被 .gitignore 忽略），避免污染工作区
const OUT_PNG = path.resolve(ROOT, argv[1] || path.join('out', 'ui-shot.png'))
const OUT_JSON = path.join(ROOT, 'out', 'ui-shot.json')

const lines = []
function log(s) {
  lines.push(String(s))
  try {
    fs.writeFileSync(OUT_JSON, JSON.stringify({ done: false, view: WANT_VIEW, lines }, null, 2), 'utf-8')
  } catch {
    /* ignore */
  }
}
const HARD = setTimeout(() => finish(2), 90000)
function finish(code) {
  clearTimeout(HARD)
  try {
    fs.writeFileSync(OUT_JSON, JSON.stringify({ done: true, view: WANT_VIEW, lines }, null, 2), 'utf-8')
  } catch {
    /* ignore */
  }
  app.exit(code)
}
process.on('uncaughtException', (e) => {
  log('夹具异常: ' + (e && e.stack ? e.stack : String(e)))
  finish(3)
})

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
}

/** 托管 out/renderer（file:// 下 ES module 会被 CORS 拦，必须走 http） */
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
      const full = path.join(RENDERER, rel)
      if (!full.startsWith(RENDERER)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      fs.readFile(full, (err, buf) => {
        if (err) {
          res.writeHead(404)
          res.end('not found')
          return
        }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream'
        })
        res.end(buf)
      })
    })
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}

/**
 * 黄像素分析。
 *
 * ⚠️ 关键经验：**不能用「偏黄像素总数」判断有没有黄框** ——
 * Windows 上 Chromium 对文字用 ClearType 亚像素抗锯齿，字符边缘天然会有一圈
 * 橙/蓝色条纹。实测日志页 0.3% 的"黄像素"全部来自搜索框占位文字的边缘。
 * 因此这里改为看**连续横run**：真正的边框/色块会产生很长的连通黄段，
 * 而文字边缘只会产生几个像素的碎段。
 */
const LONG_RUN = 40
function analyzeYellow(img) {
  const size = img.getSize()
  const bmp = img.toBitmap() // BGRA
  const isYellow = (x, y) => {
    const i = (y * size.width + x) * 4
    const b = bmp[i]
    const g = bmp[i + 1]
    const r = bmp[i + 2]
    return r > 140 && g > 120 && b < Math.min(r, g) - 40
  }
  let yellow = 0
  let sampled = 0
  let longest = 0
  let longestAt = null
  let runsOver40 = 0
  for (let y = 0; y < size.height; y += 2) {
    let run = 0
    let runStart = 0
    for (let x = 0; x < size.width; x += 2) {
      sampled++
      if (isYellow(x, y)) {
        yellow++
        if (run === 0) runStart = x
        run++
        if (run > longest) {
          longest = run
          longestAt = { x: runStart, y, length: run }
        }
      } else {
        if (run >= LONG_RUN) runsOver40++
        run = 0
      }
    }
    if (run >= LONG_RUN) runsOver40++
  }
  return {
    size,
    yellowRatio: +(yellow / sampled).toFixed(5),
    // 长连通段的数量：>0 才可能真的有黄色边框/色块
    longRuns: runsOver40,
    longestRunSampledPx: longest,
    longestAt,
    verdict:
      runsOver40 === 0
        ? '未发现长连通黄色区域（散落的黄像素=文字亚像素抗锯齿的边缘，不是黄框）'
        : `发现 ${runsOver40} 处长黄段，需要人眼确认`
  }
}

app.whenReady().then(async () => {
  try {
    if (!fs.existsSync(path.join(RENDERER, 'index.html'))) {
      log('找不到 out/renderer/index.html —— 请先跑 npm run build')
      finish(1)
      return
    }
    const { srv, port } = await serve()
    const url = `http://127.0.0.1:${port}/`
    log(`目标页面: ${WANT_VIEW}    渲染层服务: ${url}`)

    const win = new BrowserWindow({
      width: 1440,
      height: 900,
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: {
        preload: path.join(__dirname, 'ui-mock-api.cjs'),
        contextIsolation: true,
        sandbox: false,
        backgroundThrottling: false
      }
    })

    const consoleMsgs = []
    win.webContents.on('console-message', (...args) => {
      const m = args.map((a) => (typeof a === 'string' ? a : a && a.message)).filter(Boolean).join(' ')
      if (m && consoleMsgs.length < 30) consoleMsgs.push(m.slice(0, 220))
    })

    await win.loadURL(url)
    await new Promise((r) => setTimeout(r, 2500))

    const boot = await win.webContents.executeJavaScript(`(() => ({
      hasApi: typeof window.api === 'object' && window.api !== null,
      apiCount: window.api ? Object.keys(window.api).length : 0,
      mounted: document.getElementById('root') ? document.getElementById('root').childElementCount : -1,
      navLabels: [...document.querySelectorAll('.nav-btn')].map(b => b.textContent.trim())
    }))()`)
    log('启动: ' + JSON.stringify(boot))

    const clicked = await win.webContents.executeJavaScript(`(() => {
      const btns = [...document.querySelectorAll('.nav-btn')]
      const t = btns.find(b => b.textContent.trim() === ${JSON.stringify(WANT_VIEW)})
      if (!t) return 'not-found'
      t.click()
      return 'clicked'
    })()`)
    log(`点击「${WANT_VIEW}」: ${clicked}`)
    await new Promise((r) => setTimeout(r, 2200))

    if (CLICK_TEXT) {
      const r = await win.webContents.executeJavaScript(`(() => {
        const els = [...document.querySelectorAll('button')]
        const t = els.find(b => (b.textContent || '').includes(${JSON.stringify(CLICK_TEXT)}))
        if (!t) return 'not-found'
        t.click()
        return 'clicked'
      })()`)
      log(`再点击包含「${CLICK_TEXT}」的按钮: ${r}`)
      await new Promise((r2) => setTimeout(r2, 2200))
    }

    const dom = await win.webContents.executeJavaScript(`(() => {
      const q = (s) => document.querySelector(s)
      const days = [...document.querySelectorAll('.journal-day')]
      const cs = (s, prop) => { const el = q(s); return el ? getComputedStyle(el)[prop] : null }
      return {
        journal: {
          view: !!q('.journal-view'),
          dayCount: days.length,
          firstDay: days[0] ? days[0].textContent.trim().slice(0, 36) : null,
          paper: !!q('.journal-doc-inner'),
          paperWidth: q('.journal-doc-inner') ? Math.round(q('.journal-doc-inner').getBoundingClientRect().width) : null,
          editorBorder: cs('.journal-doc .editor-wrapper', 'borderTopWidth'),
          editorFontSize: cs('.journal-doc .rich-editor-content', 'fontSize'),
          editorLineHeight: cs('.journal-doc .rich-editor-content', 'lineHeight'),
          toolbarButtons: document.querySelectorAll('.journal-doc .toolbar-btn').length,
          proseMirror: !!q('.journal-doc .rich-editor-content .ProseMirror'),
          mountedChips: document.querySelectorAll('.journal-mounted-item').length
        },
        // 【共用编辑器回归检查】会议纪要等页面用的是同一个 RichTextEditor，
        // 必须仍是"盒子式"（有边框、14px），不能被日志的纸张化样式污染。
        sharedEditor: (() => {
          const w = [...document.querySelectorAll('.editor-wrapper')].find(e => !e.closest('.journal-doc'))
          if (!w) return null
          const content = w.querySelector('.rich-editor-content')
          const c = content ? getComputedStyle(content) : null
          const ws = getComputedStyle(w)
          return {
            found: true,
            inDialog: !!w.closest('[role="dialog"]'),
            borderTopWidth: ws.borderTopWidth,
            borderRadius: ws.borderTopLeftRadius,
            fontSize: c ? c.fontSize : null,
            minHeight: c ? c.minHeight : null,
            toolbarButtons: w.querySelectorAll('.toolbar-btn').length
          }
        })()
      }
    })()`)
    log('页面结构: ' + JSON.stringify(dom, null, 2))
    if (consoleMsgs.length) log('渲染层控制台:\n  ' + consoleMsgs.join('\n  '))

    // ⚠️ 截图前必须关掉动画/过渡：
    // 窗口是隐藏的（show:false），Chromium 不推进动画时钟，于是带入场动画的元素
    // （弹窗/抽屉 .wl-modal 用 wl-pop-in，keyframes 的 from 是 opacity:0）
    // 会**永远停在第一帧**，截出来就是"元素在 DOM 里但画面里没有"。
    // 实测：不关动画时「新建会议纪要」弹窗的 .editor-wrapper 在 DOM 中存在（inDialog:true）
    // 却完全不出现在截图里。关掉动画后元素回到自身基础样式，稳定可见。
    await win.webContents.insertCSS(
      '*, *::before, *::after { animation: none !important; transition: none !important; }'
    )
    await new Promise((r) => setTimeout(r, 300))

    const img = await win.webContents.capturePage()
    fs.writeFileSync(OUT_PNG, img.toPNG())
    const size = img.getSize()
    log(`截图: ${path.basename(OUT_PNG)} (${size.width}x${size.height}, ${Math.round(fs.statSync(OUT_PNG).size / 1024)} KB)`)

    const y = analyzeYellow(img)
    log('黄像素分析: ' + JSON.stringify(y, null, 2))

    srv.close()
    finish(0)
  } catch (e) {
    log('夹具异常: ' + (e && e.stack ? e.stack : String(e)))
    finish(4)
  }
})
