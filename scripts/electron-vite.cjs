// 启动 electron-vite dev 的包装脚本。
// 目的：某些环境（如 Electron 系桌面工具链）会向子进程注入 ELECTRON_RUN_AS_NODE=1，
// 该变量会让 electron.exe 以纯 Node 模式运行，导致主进程 require('electron').app 为
// undefined、应用启动即崩溃。这里在 electron-vite 拉起 electron.exe 之前清除它。
delete process.env.ELECTRON_RUN_AS_NODE

const path = require('path')
// electron-vite 的 exports 字段未暴露 ./bin/* 子路径，只能按绝对路径加载
require(path.join(__dirname, '..', 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'))
