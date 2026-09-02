import { app, Menu, nativeImage, Notification, Tray } from 'electron'
import path from 'path'
import zlib from 'zlib'
import { readSettings } from './meta'

// ---------- 生成托盘图标 PNG（纯内存，无需图片文件） ----------

const CRC_TABLE: number[] = (() => {
  const t: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

/** 生成 size×size 的蓝色圆形 PNG 图标（RGBA） */
export function makeTrayPng(size = 32): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // color type: RGBA
  header[10] = 0
  header[11] = 0
  header[12] = 0

  const c = (size - 1) / 2
  const r = (size - 1) / 2
  const rows: Buffer[] = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4) // 首字节为 filter type 0
    for (let x = 0; x < size; x++) {
      const dx = x - c
      const dy = y - c
      if (dx * dx + dy * dy <= r * r) {
        const o = 1 + x * 4
        row[o] = 0x3b
        row[o + 1] = 0x82
        row[o + 2] = 0xf6
        row[o + 3] = 0xff
      }
    }
    rows.push(row)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// ---------- 托盘 ----------

let tray: Tray | null = null

export function createTray(showWindow: () => void): void {
  // 优先使用与应用一致的图标，加载失败时退回内置蓝色圆形占位图标
  let icon = nativeImage.createFromBuffer(makeTrayPng(32))
  try {
    const p = app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(app.getAppPath(), 'build', 'icon.png')
    const fromFile = nativeImage.createFromPath(p)
    if (!fromFile.isEmpty()) {
      icon = fromFile.resize({ width: 16, height: 16 })
    }
  } catch {
    // 忽略，使用占位图标
  }
  tray = new Tray(icon)
  tray.setToolTip('日志工具')
  const menu = Menu.buildFromTemplate([
    { label: '打开日志工具', click: showWindow },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
  tray.on('click', showWindow)
}

// ---------- 提醒 ----------

let lastFired = ''

/** 每 30 秒检查一次提醒时间；命中且当天未提醒过则弹系统通知 */
export function startReminder(storageRoot: string): void {
  setInterval(async () => {
    const s = await readSettings(storageRoot)
    if (!s.reminder.enabled) return
    const now = new Date()
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    if (hm === s.reminder.time && lastFired !== today) {
      lastFired = today
      new Notification({
        title: '日志工具提醒',
        body: '该写今天的日志啦 📝'
      }).show()
    }
  }, 30000)
}
