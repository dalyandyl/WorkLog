/**
 * 数据层集成测试（`npm run test:data`）。
 *
 * 覆盖 memory-bank/07-optimization-backlog.md 中 P0-2 / P0-3 / P1-1 的核心保证：
 *   - 区间共享任务的跨天同步（同 id 写多天，改一天全部同步）
 *   - 「任务 → 日期」索引在各写路径（发布 / 更新 / 延期 / 删除）后的正确性
 *   - 损坏 JSON 文件被**隔离备份**而不是静默当空、且不会被后续写入覆盖
 *   - 原子写不残留 .tmp 文件
 *   - 并发写同一文件不丢更新
 *
 * 实现方式：用 esbuild 把 `src/main/tasks.ts` 及其数据层依赖打包成 CJS
 * （只用到 Node 内置模块与 shared 类型，不依赖 electron），在临时目录上跑真实读写。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.join(__dirname, '..')
const outFile = path.join(os.tmpdir(), 'wl-datalayer-test.cjs')

// 用 esbuild 的 JS API（直接 spawn .cmd 在 Windows + 新版 Node 上会 EINVAL）
require(path.join(root, 'node_modules', 'esbuild')).buildSync({
  entryPoints: [path.join(root, 'src', 'main', 'tasks.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: outFile,
  external: ['electron']
})

// 打包产物同时导出 tasks / taskCache / jsonStore 的公共 API
const tasksMod = require(outFile)

// 日期工具（shared/date.ts）单独打一份：主进程与渲染层共用同一实现
const dateOutFile = path.join(os.tmpdir(), 'wl-shared-date-test.cjs')
require(path.join(root, 'node_modules', 'esbuild')).buildSync({
  entryPoints: [path.join(root, 'src', 'shared', 'date.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: dateOutFile
})

// 回收站模块（trash.ts -> tasks.ts）单独打一份：验证"快照 → 删除 → 恢复"闭环
const trashOutFile = path.join(os.tmpdir(), 'wl-trash-test.cjs')
require(path.join(root, 'node_modules', 'esbuild')).buildSync({
  entryPoints: [path.join(root, 'src', 'main', 'trash.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: trashOutFile,
  external: ['electron']
})

// HTML 净化（renderer/utils/sanitize.ts）：用 domino 提供最小 DOM 实现来跑
const sanitizeOutFile = path.join(os.tmpdir(), 'wl-sanitize-test.cjs')
require(path.join(root, 'node_modules', 'esbuild')).buildSync({
  entryPoints: [path.join(root, 'src', 'renderer', 'src', 'utils', 'sanitize.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: sanitizeOutFile
})

// 附件链路（attachments.ts）与 URL 归一化（shared/attachmentUrl.ts）：只依赖 fs/path，可直接测
const attachOutFile = path.join(os.tmpdir(), 'wl-attach-test.cjs')
require(path.join(root, 'node_modules', 'esbuild')).buildSync({
  entryPoints: [path.join(root, 'src', 'main', 'attachments.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: attachOutFile
})

const urlOutFile = path.join(os.tmpdir(), 'wl-attachurl-test.cjs')
require(path.join(root, 'node_modules', 'esbuild')).buildSync({
  entryPoints: [path.join(root, 'src', 'shared', 'attachmentUrl.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: urlOutFile
})

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-data-'))
let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) {
    pass++
    console.log('  ✓ ' + name)
  } else {
    fail++
    console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''))
  }
}

async function main() {
  console.log('临时数据目录:', tmpRoot)

  // ---------- 1. 基础读写 ----------
  console.log('\n[1] 基础读写')
  const t = await tasksMod.createTask(tmpRoot, '2026-01-05', {
    title: '任务A',
    tags: [],
    body: '',
    subtasks: []
  })
  let list = await tasksMod.readTasks(tmpRoot, '2026-01-05')
  check('createTask 后可读回', list.length === 1 && list[0].title === '任务A')

  // ---------- 2. 区间共享任务跨天同步 ----------
  console.log('\n[2] 区间共享任务（同一 id 写多天 + updateTask 全局同步）')
  const pub = await tasksMod.publishTasks(tmpRoot, ['2026-02-02', '2026-02-03', '2026-02-04'], {
    title: '周任务',
    tags: [],
    body: '',
    subtasks: []
  })
  check('publishTasks 写入 3 天', pub.count === 3 && pub.instances.length === 3)
  const sharedId = pub.instances[0].taskId
  const dates = await tasksMod.datesOfTask(tmpRoot, sharedId)
  check('datesOfTask 返回 3 天', dates.length === 3, JSON.stringify(dates))

  await tasksMod.updateTask(tmpRoot, '2026-02-03', sharedId, { title: '改名后', done: true })
  const d1 = await tasksMod.readTasks(tmpRoot, '2026-02-02')
  const d2 = await tasksMod.readTasks(tmpRoot, '2026-02-04')
  check(
    '改中间那天，其他天同步（标题+完成）',
    d1[0].title === '改名后' && d1[0].done === true && d2[0].done === true,
    JSON.stringify({ d1: d1[0].title, done1: d1[0].done, done2: d2[0].done })
  )
  check('completedAt 已记录', typeof d1[0].completedAt === 'string' && d1[0].completedAt.length > 0)

  // ---------- 3. updateTask 后索引仍然正确（增量维护） ----------
  console.log('\n[3] 写操作后索引不被写坏')
  const datesAfter = await tasksMod.datesOfTask(tmpRoot, sharedId)
  check('更新后 datesOfTask 仍是 3 天', datesAfter.length === 3, JSON.stringify(datesAfter))

  await tasksMod.postponeTask(tmpRoot, '2026-02-02', sharedId, ['2026-02-06'])
  const datesAfterPostponeDone = await tasksMod.datesOfTask(tmpRoot, sharedId)
  check(
    '已完成任务拒绝延期（返回后日期数不变）',
    datesAfterPostponeDone.length === 3,
    JSON.stringify(datesAfterPostponeDone)
  )

  // 取消完成后再延期，验证索引能正确增量增长、重叠日期跳过
  await tasksMod.updateTask(tmpRoot, '2026-02-02', sharedId, { done: false })
  const postponed = await tasksMod.postponeTask(tmpRoot, '2026-02-02', sharedId, [
    '2026-02-05',
    '2026-02-02'
  ])
  check('未完成任务延期成功且只加 1 天', postponed.ok && postponed.added === 1, JSON.stringify(postponed))
  const datesAfterPostpone = await tasksMod.datesOfTask(tmpRoot, sharedId)
  check(
    '延期后 datesOfTask 增加到 4 天（重叠日期跳过）',
    datesAfterPostpone.length === 4,
    JSON.stringify(datesAfterPostpone)
  )

  // ---------- 4. 删除跨天任务 ----------
  console.log('\n[4] 删除跨天共享任务')
  await tasksMod.deleteTask(tmpRoot, '2026-02-03', sharedId)
  const remaining = []
  for (const d of ['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05']) {
    const l = await tasksMod.readTasks(tmpRoot, d)
    remaining.push(l.filter((x) => x.id === sharedId).length)
  }
  check('所有天的副本都被删除', remaining.every((n) => n === 0), JSON.stringify(remaining))
  const afterDelete = await tasksMod.datesOfTask(tmpRoot, sharedId)
  check('删除后索引也不再包含该任务', afterDelete.length === 0, JSON.stringify(afterDelete))

  // ---------- 5. 损坏文件隔离（P0-2 核心） ----------
  console.log('\n[5] 损坏文件必须被隔离而不是静默当空 + 不被覆盖')
  const badDate = '2026-03-09'
  const badFile = path.join(tmpRoot, '2026', '2026-03-09.json')
  fs.mkdirSync(path.dirname(badFile), { recursive: true })
  const junk = '{"tasks": [ {"id": "x", "title": "被截断'
  fs.writeFileSync(badFile, junk, 'utf-8')

  const readBack = await tasksMod.readTasks(tmpRoot, badDate)
  check('损坏文件读取返回空数组（不抛错）', readBack.length === 0)

  const dirFiles = fs.readdirSync(path.join(tmpRoot, '2026'))
  const quarantined = dirFiles.filter((f) => f.includes('.corrupt-'))
  check('损坏文件已被改名隔离', quarantined.length === 1, JSON.stringify(dirFiles))
  if (quarantined.length === 1) {
    const content = fs.readFileSync(path.join(tmpRoot, '2026', quarantined[0]), 'utf-8')
    check('隔离文件内容仍是原始损坏内容（证据保留）', content === junk)
  }

  // 写入后不应破坏隔离文件
  await tasksMod.createTask(tmpRoot, badDate, {
    title: '新任务',
    tags: [],
    body: '',
    subtasks: []
  })
  const afterWrite = await tasksMod.readTasks(tmpRoot, badDate)
  check('隔离后写入正常创建新文件', afterWrite.length === 1 && afterWrite[0].title === '新任务')
  check(
    '隔离文件仍存在（未被新写入覆盖）',
    fs.readdirSync(path.join(tmpRoot, '2026')).filter((f) => f.includes('.corrupt-')).length === 1
  )

  // ---------- 6. 原子写：不残留临时文件 ----------
  console.log('\n[6] 原子写不残留临时文件')
  const leftovers = fs
    .readdirSync(path.join(tmpRoot, '2026'))
    .filter((f) => f.includes('.tmp-'))
  check('没有 .tmp- 残留', leftovers.length === 0, JSON.stringify(leftovers))

  // ---------- 7. 并发写不丢更新（P0-3 核心） ----------
  console.log('\n[7] 并发写同一文件不丢更新')
  const cDate = '2026-04-01'
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      tasksMod.publishTasks(tmpRoot, [cDate], {
        title: '并发' + i,
        tags: [],
        body: '',
        subtasks: []
      })
    )
  )
  const cList = await tasksMod.readTasks(tmpRoot, cDate)
  check('20 个并发发布全部写入（无丢更新）', cList.length === 20, '实际 ' + cList.length)

  // ---------- 8. 日期与 ISO 周工具（P2-6 合并后的唯一实现） ----------
  console.log('\n[8] 日期与 ISO 周工具')
  const dateMod = require(dateOutFile)

  check('toDateStr 本地时区格式化', dateMod.toDateStr(new Date(2026, 0, 5)) === '2026-01-05')
  check('weekdayName 中文星期', dateMod.weekdayName('2026-01-05') === '周一')

  // ISO 周 1 的边界：2026-01-01 是周四 → 属于 2026 年第 1 周，该周从 2025-12-29 起
  const w1 = dateMod.getWeekInfo('2026-01-01')
  check('2026-01-01 属于 2026-W01', w1.weekKey === '2026-W01', w1.weekKey)
  check('2026-W01 周一为 2025-12-29', w1.start === '2025-12-29', w1.start)
  check('2026-W01 周日为 2026-01-04', w1.end === '2026-01-04', w1.end)
  check('getWeekInfo 返回 7 天', w1.dates.length === 7)

  // 跨年周：2025-12-31 属于 2026-W01（ISO 年按周四所属年）
  check('2025-12-31 属于 2026-W01', dateMod.getWeekInfo('2025-12-31').weekKey === '2026-W01')

  // W53 年份：2020 年有第 53 周
  const w53 = dateMod.getWeekInfo('2020-12-28')
  check('2020-12-28 属于 2020-W53', w53.weekKey === '2020-W53', w53.weekKey)

  // weekKeyToDates ↔ getWeekInfo 往返一致（含 W53 这种边界）
  let roundTripOk = true
  for (const key of ['2026-W01', '2026-W36', '2020-W53', '2024-W09']) {
    const dates = dateMod.weekKeyToDates(key)
    if (dates.length !== 7) {
      roundTripOk = false
      break
    }
    if (dateMod.getWeekInfo(dates[0]).weekKey !== key) {
      roundTripOk = false
      break
    }
  }
  check('weekKeyToDates ↔ getWeekInfo 往返一致（含 W53）', roundTripOk)
  check('非法 weekKey 返回空数组', dateMod.weekKeyToDates('2026-W9').length === 0)

  const span = dateMod.enumerateDates('2026-01-30', '2026-02-02')
  check(
    'enumerateDates 含端点且跨月正确',
    span.join(',') === '2026-01-30,2026-01-31,2026-02-01,2026-02-02',
    span.join(',')
  )
  check('enumerateDates 起点晚于终点返回空', dateMod.enumerateDates('2026-02-02', '2026-01-30').length === 0)

  // ---------- 9. 回收站：快照 → 删除 → 恢复 闭环（P3-11） ----------
  console.log('\n[9] 回收站快照与恢复')
  const trashMod = require(trashOutFile)

  const tDates = ['2026-05-04', '2026-05-05', '2026-05-06']
  const tPub = await tasksMod.publishTasks(tmpRoot, tDates, {
    title: '待回收任务',
    tags: [],
    body: '',
    subtasks: []
  })
  const tId = tPub.instances[0].taskId

  const snap = await trashMod.snapshotTaskToTrash(tmpRoot, tId)
  check('快照收集到跨天全部副本（3 条）', snap.ok && snap.count === 3, JSON.stringify(snap))

  await tasksMod.deleteTask(tmpRoot, tDates[0], tId)
  const goneCount = (
    await Promise.all(
      tDates.map(async (d) => (await tasksMod.readTasks(tmpRoot, d)).filter((x) => x.id === tId).length)
    )
  ).reduce((a, b) => a + b, 0)
  check('删除后所有天的副本都消失', goneCount === 0, String(goneCount))

  const items = await trashMod.listTrash(tmpRoot)
  check('回收站里有 1 条记录', items.length === 1, String(items.length))
  check('回收站条目保留了 3 个实例快照', items[0]?.tasks.length === 3)

  // 恢复：先重放成功再移出回收站（旧实现是"取出即移除"，失败即丢数据）
  const target = await trashMod.findTrashItem(tmpRoot, items[0].id)
  check('findTrashItem 能取到条目且不移除它', !!target)
  check('findTrashItem 之后条目仍在回收站', (await trashMod.listTrash(tmpRoot)).length === 1)

  await tasksMod.restoreTasksToDays(
    tmpRoot,
    target.tasks.map((t) => ({ date: t.date, task: t.task }))
  )
  const backCount = (
    await Promise.all(
      tDates.map(async (d) => (await tasksMod.readTasks(tmpRoot, d)).filter((x) => x.id === tId).length)
    )
  ).reduce((a, b) => a + b, 0)
  check('恢复后 3 天都回来了', backCount === 3, String(backCount))

  // 重复恢复不应产生同 id 重复项
  await tasksMod.restoreTasksToDays(
    tmpRoot,
    target.tasks.map((t) => ({ date: t.date, task: t.task }))
  )
  const dupCount = (await tasksMod.readTasks(tmpRoot, tDates[0])).filter((x) => x.id === tId).length
  check('重复恢复不产生同 id 重复项', dupCount === 1, String(dupCount))

  // 恢复成功后索引仍然正确
  check(
    '恢复后 datesOfTask 恢复到 3 天',
    (await tasksMod.datesOfTask(tmpRoot, tId)).length === 3
  )

  await trashMod.removeTrashItem(tmpRoot, items[0].id)
  check('移出回收站后列表为空', (await trashMod.listTrash(tmpRoot)).length === 0)

  // ---------- 10. HTML 净化（P3-1） ----------
  console.log('\n[10] HTML 净化 sanitizeHtml')
  // 用 domino（turndown 的依赖，已在 node_modules）提供最小 DOM
  const domino = require(path.join(root, 'node_modules', '@mixmark-io', 'domino'))
  global.document = domino.createDocument('<html><body></body></html>')
  const { sanitizeHtml } = require(sanitizeOutFile)

  check('保留普通段落与内联格式', sanitizeHtml('<p>你好 <strong>世界</strong></p>').includes('<strong>世界</strong>'))
  check('保留表格结构', sanitizeHtml('<table><tr><td>a</td></tr></table>').includes('<td>a</td>'))
  check('保留 wlattach 附件图片', sanitizeHtml('<img src="wlattach://attachments/a/b.png">').includes('wlattach://'))

  const xss1 = sanitizeHtml('<img src=x onerror="alert(1)">')
  check('去掉 img 的 onerror 事件', !/onerror/i.test(xss1), xss1)

  const xss2 = sanitizeHtml('<script>alert(1)<\/script>')
  check('整棵删除 script 子树（含文本）', !/alert/.test(xss2) && !/script/i.test(xss2), xss2)

  const xss3 = sanitizeHtml('<a href="javascript:alert(1)">x</a>')
  check('去掉 javascript: 协议链接', !/javascript:/i.test(xss3), xss3)

  const xss4 = sanitizeHtml('<a href="java\nscript:alert(1)">x</a>')
  check('去掉带换行混淆的 javascript: 链接', !/script:/i.test(xss4), xss4)

  const xss5 = sanitizeHtml('<p style="background:url(javascript:alert(1))">x</p>')
  check('去掉 style 中的 url() 注入', !/url\s*\(/i.test(xss5), xss5)

  const xss6 = sanitizeHtml('<p style="position:fixed;top:0">x</p>')
  check('去掉 style 中的覆盖层定位', !/position\s*:\s*fixed/i.test(xss6), xss6)

  const keep1 = sanitizeHtml('<span style="color:#ff0000">红</span>')
  check('保留合法的文字颜色 style', /color:#ff0000/i.test(keep1), keep1)

  const keep2 = sanitizeHtml('<span data-math="x^2"></span>')
  check('保留公式占位 span[data-math]', /data-math="x\^2"/.test(keep2), keep2)

  const keep3 = sanitizeHtml('<a href="https://example.com" target="_blank">外链</a>')
  check('保留 https 外链', /href="https:\/\/example\.com"/.test(keep3), keep3)

  const unwrap1 = sanitizeHtml('<font color="red">文字</font>')
  check('未知标签拆壳但保留文字', unwrap1.includes('文字') && !/<font/i.test(unwrap1), unwrap1)

  check('空输入返回空串', sanitizeHtml('') === '')

  // ---------- 11. 附件链路与 URL 归一化（图片显示 bug 的回归防护） ----------
  console.log('\n[11] 附件链路与 URL 归一化')
  const attachMod = require(attachOutFile)
  const { normalizeAttachmentUrl } = require(urlOutFile)

  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082',
    'hex'
  )
  const saved = await attachMod.saveAttachmentBuffer(
    tmpRoot,
    'publish',
    '我的 截图.png',
    png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)
  )

  check('saveAttachmentBuffer 返回 { url, file } 对象', typeof saved === 'object' && !!saved.url && !!saved.file)
  check(
    'url 是 wlattach:// 字符串',
    typeof saved.url === 'string' && saved.url.startsWith('wlattach://attachments/publish/'),
    String(saved.url)
  )
  check('落盘文件真实存在', fs.existsSync(saved.file))

  // 这是当初的事故点：把对象插进模板字符串会得到 "[object Object]"
  check(
    '【回归】对象直接插入模板字符串会产生 [object Object]（说明必须取 .url）',
    `${saved}`.includes('[object Object]')
  )

  // 归一化必须能从两种形态里都取出正确 URL
  check('归一化：字符串原样返回', normalizeAttachmentUrl(saved.url) === saved.url)
  check('归一化：对象取 .url', normalizeAttachmentUrl(saved) === saved.url)
  check('归一化：非法输入返回空串', normalizeAttachmentUrl({}) === '' && normalizeAttachmentUrl(null) === '')

  // 渲染层两种插值方式在修复后都必须是合法 URL
  const md = `![](${normalizeAttachmentUrl(saved)})`
  const html = `<img src="${normalizeAttachmentUrl(saved)}" alt="x">`
  check('Markdown 插值得到合法附件链接', /!\[\]\(wlattach:\/\/attachments\/publish\/.+\)/.test(md), md)
  check('HTML 插值得到合法 src', /src="wlattach:\/\/attachments\/publish\/.+"/.test(html), html)

  // 路径穿越防护仍然有效（P3-2）
  const evil = await attachMod.saveAttachmentBuffer(
    tmpRoot,
    '../../evil',
    'x.png',
    png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)
  )
  check(
    '恶意 folder 被净化，写入仍在 attachments 内',
    evil.file.startsWith(path.join(tmpRoot, 'attachments') + path.sep) &&
      !evil.file.includes('..'),
    evil.file
  )
  check('恶意 folder 的 URL 不含 ..', !evil.url.includes('..'), evil.url)

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
  fs.rmSync(tmpRoot, { recursive: true, force: true })
  for (const f of [outFile, dateOutFile, trashOutFile, sanitizeOutFile, attachOutFile, urlOutFile]) {
    fs.rmSync(f, { force: true })
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('测试异常:', err)
  process.exit(1)
})
