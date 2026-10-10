/**
 * `npm run ui:shot` 的启动包装。
 *
 * 两个必须由包装脚本处理的事：
 *   1. **清除 `ELECTRON_RUN_AS_NODE`** —— 某些环境（含 Electron 系桌面工具链）会向子进程注入它，
 *      导致 electron.exe 退化为纯 Node（`require('electron')` 返回二进制路径字符串、
 *      `app`/`protocol` 全为 undefined）。真实应用由 `electron-vite.cjs` 负责清，
 *      这里的夹具同样要清，否则探针必然启动失败。
 *   2. 用 `require('electron')` 拿到 electron.exe 的**绝对路径**再 spawn
 *      （直接 spawn `.cmd` 在 Windows + 新版 Node 上会 EINVAL）。
 *
 * 额外参数直接透传：`npm run ui:shot -- 任务 out.png`
 */
delete process.env.ELECTRON_RUN_AS_NODE

const { spawn } = require('child_process')
const path = require('path')

const electronBin = require('electron')
const args = [path.join(__dirname, 'ui-shot.cjs'), ...process.argv.slice(2)]

const child = spawn(electronBin, args, { stdio: 'inherit', windowsHide: true })
child.on('exit', (code) => process.exit(code === null ? 1 : code))
