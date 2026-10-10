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

// 日志数据层（journal.ts -> jsonStore.ts + paths.ts）：全链路无 electron 依赖
const journalOutFile = path.join(os.tmpdir(), 'wl-journal-test.cjs')
require(path.join(root, 'node_modules', 'esbuild')).buildSync({
  entryPoints: [path.join(root, 'src', 'main', 'journal.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: journalOutFile
})

// 搜索（search.ts -> tasks/tags/journal）：验证日志被纳入检索
const searchOutFile = path.join(os.tmpdir(), 'wl-search-test.cjs')
require(path.join(root, 'node_modules', 'esbuild')).buildSync({
  entryPoints: [path.join(root, 'src', 'main', 'search.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: searchOutFile,
  external: ['electron']
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

  // ---------- 12. 日志数据层（一天一篇连续文档） ----------
  console.log('\n[12] 日志数据层（一天一篇）')
  const journal = require(journalOutFile)

  // 12.1 保存 → 落盘到 journal/<年>/<日期>.json
  const saved1 = await journal.saveJournalDay(tmpRoot, '2026-10-10', {
    body: '<p>今天研究了苹果派的做法</p>'
  })
  check('保存后返回规范化的整天', saved1.date === '2026-10-10' && saved1.body.includes('苹果派'))
  check('createdAt / updatedAt 已填充', !!saved1.createdAt && !!saved1.updatedAt)
  const jFile = path.join(tmpRoot, 'journal', '2026', '2026-10-10.json')
  check('日志天文件落在 journal/<年>/<日期>.json', fs.existsSync(jFile))

  // 12.2 读回
  const day1 = await journal.readJournalDay(tmpRoot, '2026-10-10')
  check('读回正文一致', !!day1 && day1.body === '<p>今天研究了苹果派的做法</p>')
  check('未写过的日期返回 null', (await journal.readJournalDay(tmpRoot, '2020-01-01')) === null)

  // 12.3 覆盖式保存；保留 createdAt
  const saved2 = await journal.saveJournalDay(tmpRoot, '2026-10-10', { body: '<p>改过的内容</p>' })
  check('重复保存是覆盖而不是追加', saved2.body === '<p>改过的内容</p>')
  check('重复保存保留 createdAt', saved2.createdAt === saved1.createdAt)

  // 12.4 只传部分字段时保留其余字段
  await journal.saveJournalDay(tmpRoot, '2026-10-10', {
    attachments: [
      { id: 'a1', name: '报表.xlsx', url: 'wlattach://attachments/journal/x.xlsx', type: 'file' }
    ]
  })
  const day2 = await journal.readJournalDay(tmpRoot, '2026-10-10')
  check('未传 body 时保留原正文', !!day2 && day2.body === '<p>改过的内容</p>')
  check('附件已保存', !!day2 && day2.attachments.length === 1 && day2.attachments[0].name === '报表.xlsx')

  // 12.5 关联任务快照（只存标题 + 完成状态；非法项过滤；按 taskId 去重）
  await journal.saveJournalDay(tmpRoot, '2026-10-10', {
    mountedTasks: [
      { taskId: 't1', date: '2026-10-10', title: '写周报', done: false },
      { taskId: 't1', date: '2026-10-10', title: '重复项', done: true },
      { title: '没有 taskId' },
      null
    ]
  })
  const day3 = await journal.readJournalDay(tmpRoot, '2026-10-10')
  check(
    '关联任务被存为快照且去重 / 过滤非法项',
    !!day3 && day3.mountedTasks.length === 1 && day3.mountedTasks[0].title === '写周报'
  )

  // 12.6 【向后兼容】旧格式 { entries: [...] } 自动合并成一整篇
  const legacyFile = path.join(tmpRoot, 'journal', '2026', '2026-10-05.json')
  fs.mkdirSync(path.dirname(legacyFile), { recursive: true })
  fs.writeFileSync(
    legacyFile,
    JSON.stringify(
      {
        date: '2026-10-05',
        entries: [
          {
            id: 'e1',
            time: '09:00',
            body: '<p>早上</p>',
            attachments: [],
            mountedTasks: [],
            createdAt: '2026-10-05T01:00:00.000Z',
            updatedAt: '2026-10-05T01:00:00.000Z'
          },
          {
            id: 'e2',
            time: '18:30',
            body: '<p>傍晚</p>',
            attachments: [
              { id: 'x', name: 'n.txt', url: 'wlattach://attachments/journal/n.txt', type: 'file' }
            ],
            mountedTasks: [{ taskId: 't9', date: '2026-10-05', title: '旧任务', done: true }],
            createdAt: '2026-10-05T10:00:00.000Z',
            updatedAt: '2026-10-05T10:00:00.000Z'
          }
        ]
      },
      null,
      2
    ),
    'utf-8'
  )
  const legacyDay = await journal.readJournalDay(tmpRoot, '2026-10-05')
  check(
    '旧格式被读成一整篇（两段内容都在）',
    !!legacyDay && legacyDay.body.includes('早上') && legacyDay.body.includes('傍晚'),
    legacyDay && legacyDay.body
  )
  check(
    '旧格式的时间信息被保留为小标题',
    !!legacyDay && legacyDay.body.includes('09:00') && legacyDay.body.includes('18:30')
  )
  check(
    '旧格式的附件被合并',
    !!legacyDay && legacyDay.attachments.length === 1 && legacyDay.attachments[0].name === 'n.txt'
  )
  check(
    '旧格式的关联任务被合并',
    !!legacyDay && legacyDay.mountedTasks.length === 1 && legacyDay.mountedTasks[0].title === '旧任务'
  )
  check('旧格式的 updatedAt 取最晚的一条', !!legacyDay && legacyDay.updatedAt === '2026-10-05T10:00:00.000Z')
  check(
    '读取旧格式不会改写文件（仍是 entries）',
    JSON.parse(fs.readFileSync(legacyFile, 'utf-8')).entries.length === 2
  )

  // 12.6b 旧格式只有**一条**时不插入时间小标题（用户真实数据就是这个形态）
  const oneFile = path.join(tmpRoot, 'journal', '2026', '2026-10-06.json')
  fs.writeFileSync(
    oneFile,
    JSON.stringify({
      date: '2026-10-06',
      entries: [{ id: 'o1', time: '17:40', body: '<p>日志1</p><p></p>', attachments: [], mountedTasks: [] }]
    }),
    'utf-8'
  )
  const oneDay = await journal.readJournalDay(tmpRoot, '2026-10-06')
  check(
    '旧格式单条不凭空多出时间行',
    !!oneDay && !oneDay.body.includes('17:40') && oneDay.body.includes('日志1'),
    oneDay && oneDay.body
  )

  // 12.7 整天为空 → 删除文件（不留空壳）
  await journal.saveJournalDay(tmpRoot, '2026-10-11', { body: '<p>x</p>' })
  const emptyFile = path.join(tmpRoot, 'journal', '2026', '2026-10-11.json')
  check('写入后文件存在', fs.existsSync(emptyFile))
  await journal.saveJournalDay(tmpRoot, '2026-10-11', { body: '<p></p>' })
  check('清空正文后文件被删除（不留空壳）', !fs.existsSync(emptyFile))

  // 12.8 日期校验（含路径穿越）
  let rejected = 0
  for (const bad of ['../../evil', '2026-1-1', '', '2026-10-10/../..', 'x', '2026-10-10.json']) {
    try {
      await journal.readJournalDay(tmpRoot, bad)
    } catch {
      rejected++
    }
  }
  check('非法日期全部被拒绝（含路径穿越）', rejected === 6, String(rejected))
  check(
    'isValidJournalDate 判定正确',
    journal.isValidJournalDate('2026-10-10') && !journal.isValidJournalDate('../../x')
  )

  // 12.9 损坏文件隔离（与任务天文件同一套 jsonStore 语义）
  await journal.saveJournalDay(tmpRoot, '2026-10-12', { body: '<p>y</p>' })
  const jBad = path.join(tmpRoot, 'journal', '2026', '2026-10-12.json')
  fs.writeFileSync(jBad, '{ 被截断了', 'utf-8')
  check('损坏日志按 null 处理（不抛错）', (await journal.readJournalDay(tmpRoot, '2026-10-12')) === null)
  check(
    '损坏日志文件被隔离为 .corrupt-*',
    fs.readdirSync(path.dirname(jBad)).some((f) => f.includes('.corrupt-'))
  )

  // 12.10 listJournalDates 只认 4 位年份目录
  fs.mkdirSync(path.join(tmpRoot, 'journal', 'not-a-year'), { recursive: true })
  fs.writeFileSync(path.join(tmpRoot, 'journal', 'not-a-year', '2026-01-01.json'), '{}', 'utf-8')
  const jDates = await journal.listJournalDates(tmpRoot)
  check(
    'listJournalDates 只认 4 位年份目录',
    jDates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) && !jDates.includes('2026-01-01'),
    jDates.join(',')
  )

  // 12.11 左栏摘要：倒序 + 预览 + 分页 + 跳过空白
  for (const d of ['2026-10-13', '2026-10-14', '2026-10-15']) {
    await journal.saveJournalDay(tmpRoot, d, { body: `<p>${d} 的内容</p>` })
  }
  const sums = await journal.listJournalSummaries(tmpRoot, { limit: 3 })
  check(
    '摘要按日期倒序',
    sums.length === 3 && sums[0].date === '2026-10-15' && sums[2].date === '2026-10-13',
    sums.map((s) => s.date).join(',')
  )
  check('摘要带正文预览', sums[0].preview.includes('2026-10-15'), sums[0].preview)
  check('摘要带关联任务计数', sums[0].mountedCount === 0)
  const older = await journal.listJournalSummaries(tmpRoot, { before: '2026-10-13', limit: 10 })
  check(
    '摘要 before 分页生效',
    older.length > 0 && older.every((s) => s.date < '2026-10-13'),
    older.map((s) => s.date).join(',')
  )
  const allSums = await journal.listJournalSummaries(tmpRoot, { limit: 50 })
  check(
    '摘要不包含空白文档（已清空的那天不出现）',
    !allSums.some((s) => s.date === '2026-10-11')
  )

  // 12.12 【兼容性硬约束】日志数据不得被任务侧扫描误判
  await tasksMod.publishTasks(tmpRoot, ['2026-10-20'], { title: '真实任务' })
  const scanDates = await tasksMod.listDatesWithTasks(tmpRoot)
  check('任务日期扫描仍能找到真实任务', scanDates.includes('2026-10-20'), scanDates.join(','))
  check(
    '【兼容】日志日期不会污染任务日期扫描',
    !scanDates.some((d) => d.startsWith('2026-10-1') && d !== '2026-10-20'),
    scanDates.join(',')
  )

  // 12.13 并发保存同一天：写锁 + 原子写，结果必须是完整的某一版而不是半个文件
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      journal.saveJournalDay(tmpRoot, '2026-10-16', { body: `<p>并发${i}</p>` })
    )
  )
  const conc = await journal.readJournalDay(tmpRoot, '2026-10-16')
  check(
    '20 个并发保存后正文是完整的一版（无半截文件）',
    !!conc && /^<p>并发\d+<\/p>$/.test(conc.body),
    conc && conc.body
  )

  // ---------- 13. 日志纳入搜索与回收站 ----------
  console.log('\n[13] 日志纳入搜索与回收站')
  const search = require(searchOutFile)

  await journal.saveJournalDay(tmpRoot, '2026-11-01', {
    body: '<p>今天研究了<strong>苹果派</strong>的做法</p>'
  })
  await tasksMod.publishTasks(tmpRoot, ['2026-11-01'], { title: '买苹果派原料' })

  const jHits = await search.searchJournal(tmpRoot, '苹果派')
  check(
    'searchJournal 能命中日志正文（HTML 已纯文本化）',
    jHits.length === 1 && jHits[0].kind === 'journal' && jHits[0].date === '2026-11-01',
    JSON.stringify(jHits.map((h) => h.date))
  )
  check('日志命中项的 snippet 含关键词上下文', jHits[0].snippet.includes('苹果派'), jHits[0].snippet)

  const allHits = await search.searchAll(tmpRoot, '苹果派')
  const kinds = allHits.map((h) => h.kind).sort()
  check(
    'searchAll 同时返回任务与日志命中',
    kinds.includes('task') && kinds.includes('journal'),
    JSON.stringify(kinds)
  )
  check('searchAll 按日期倒序', allHits.every((h, i) => i === 0 || allHits[i - 1].date >= h.date))
  check(
    'searchTasks 仍然只返回任务（向后兼容）',
    (await search.searchTasks(tmpRoot, '苹果派')).every((h) => h.kind === 'task')
  )
  check('空关键词返回空数组', (await search.searchAll(tmpRoot, '   ')).length === 0)

  // 回收站闭环：快照 → 删除 → 恢复
  const doomed = await journal.saveJournalDay(tmpRoot, '2026-11-02', {
    body: '<p>待删除的日志</p>'
  })
  const journalSnap = await trashMod.snapshotJournalDayToTrash(tmpRoot, '2026-11-02', doomed)
  check('日志可整天快照进回收站', journalSnap.ok === true)

  const tItem = (await trashMod.listTrash(tmpRoot)).find((i) => i.journal)
  check(
    '回收站条目带 journal 且 tasks 为空数组',
    !!tItem &&
      Array.isArray(tItem.tasks) &&
      tItem.tasks.length === 0 &&
      tItem.journal.day.body === '<p>待删除的日志</p>',
    JSON.stringify(tItem && { title: tItem.title, hasJournal: !!tItem.journal })
  )
  check('回收站标题含日期', !!tItem && tItem.title.includes('2026-11-02'), tItem && tItem.title)

  await journal.deleteJournalDay(tmpRoot, '2026-11-02')
  check('删除后该天读不到', (await journal.readJournalDay(tmpRoot, '2026-11-02')) === null)
  check(
    '删除不存在的天返回 null（幂等）',
    (await journal.deleteJournalDay(tmpRoot, '2020-02-02')) === null
  )

  const restored = await trashMod.restoreTrashItem(tmpRoot, tItem.id)
  check('从回收站恢复日志成功', restored.ok === true)
  const back = await journal.readJournalDay(tmpRoot, '2026-11-02')
  check(
    '恢复后正文完整回来',
    !!back && back.body === '<p>待删除的日志</p>',
    JSON.stringify(back && back.body)
  )
  check(
    '恢复后该条目已移出回收站',
    !(await trashMod.listTrash(tmpRoot)).some((i) => i.id === tItem.id)
  )
  check(
    '恢复不存在的 id 返回 ok:false',
    (await trashMod.restoreTrashItem(tmpRoot, 'nope')).ok === false
  )

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
  fs.rmSync(tmpRoot, { recursive: true, force: true })
  for (const f of [
    outFile,
    dateOutFile,
    trashOutFile,
    sanitizeOutFile,
    attachOutFile,
    urlOutFile,
    journalOutFile,
    searchOutFile
  ]) {
    fs.rmSync(f, { force: true })
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('测试异常:', err)
  process.exit(1)
})
