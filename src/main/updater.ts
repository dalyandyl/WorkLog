// 自动更新（Gitee 发行版 / Releases 附件方案）
//
// 背景：Gitee 不提供 electron-updater 官方发布源，且私密仓库的网页 raw 下载
// 必须登录（会话 cookie），令牌 query/header 均无效。实测可用的是 Gitee API v5：
//   - GET /repos/{owner}/{repo}/releases/latest        -> 最新发行版（含附件名）
//   - GET /repos/{owner}/{repo}/releases/{id}/attach_files -> 附件列表（含 id）
//   - GET /repos/{owner}/{repo}/releases/{id}/attach_files/{fileId}/download
//                                                    -> 附件内容（带 access_token）
// 因此本模块自行实现「检测 -> 下载 -> 校验 -> 安装」全流程，与渲染层事件保持兼容。
//
// 发布侧：scripts/publish-gitee.ps1 构建后用 Gitee API 创建发行版并上传附件
// （latest.yml + setup.exe）。
import { app, net } from 'electron'
import { createWriteStream } from 'fs'
import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'
import yaml from 'js-yaml'
import semver from 'semver'
import { UPDATE_CONFIG } from './updater-config'

export type UpdateBroadcast = (channel: string, payload: unknown) => void

interface GiteeRelease {
  id: number
  tag_name: string
  name?: string | null
  assets?: { name: string; browser_download_url: string }[]
}

interface GiteeAttachment {
  id: number
  name: string
  size?: number
}

interface UpdateFileInfo {
  url: string
  sha512?: string
  size?: number
}

interface LatestYml {
  version?: string
  files?: UpdateFileInfo[]
  path?: string
  sha512?: string
  releaseDate?: string
}

interface UpdateState {
  version: string
  installer: string
  downloadedAt: string
}

let broadcast: UpdateBroadcast = () => {}
let updateDir = ''

/** 注册更新事件广播（由主进程在窗口创建后调用） */
export function initUpdater(cb: UpdateBroadcast): void {
  broadcast = cb
  updateDir = path.join(app.getPath('temp'), 'worklog-update')
}

// ---------------- Gitee API ----------------

function apiUrl(pathname: string): string {
  const sep = pathname.includes('?') ? '&' : '?'
  return `https://gitee.com/api/v5${pathname}${sep}access_token=${encodeURIComponent(UPDATE_CONFIG.token)}`
}

async function apiGet<T>(pathname: string): Promise<T> {
  const res = await net.fetch(apiUrl(pathname))
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 200)
    } catch {
      /* ignore */
    }
    throw new Error(`Gitee API HTTP ${res.status}：${detail || res.statusText}`)
  }
  return (await res.json()) as T
}

/** 流式下载附件到本地，返回 { filePath, sha512 }（sha512 为 base64） */
async function downloadAttachment(
  releaseId: number,
  attachmentId: number,
  dest: string,
  onProgress?: (percent: number) => void
): Promise<{ filePath: string; sha512: string }> {
  const res = await net.fetch(
    apiUrl(`/repos/${UPDATE_CONFIG.owner}/${UPDATE_CONFIG.repo}/releases/${releaseId}/attach_files/${attachmentId}/download`)
  )
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 200)
    } catch {
      /* ignore */
    }
    throw new Error(`下载失败 HTTP ${res.status}：${detail || res.statusText}`)
  }
  const total = Number(res.headers.get('content-length') ?? 0)
  const body = res.body
  if (!body) throw new Error('下载响应无内容')
  const reader = body.getReader()
  const writer = createWriteStream(dest)
  const hash = crypto.createHash('sha512')
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && value.length > 0) {
        const buf = Buffer.from(value)
        hash.update(buf)
        if (!writer.write(buf)) {
          await new Promise<void>((resolve) => writer.once('drain', resolve))
        }
        received += buf.length
        if (total > 0 && onProgress) {
          onProgress(Math.round((received / total) * 100))
        }
      }
    }
    await new Promise<void>((resolve, reject) => {
      writer.on('finish', resolve)
      writer.on('error', reject)
      writer.end()
    })
  } catch (err) {
    writer.destroy()
    throw err
  }
  return { filePath: dest, sha512: hash.digest('base64') }
}

async function getLatestRelease(): Promise<GiteeRelease | null> {
  try {
    return await apiGet<GiteeRelease>(
      `/repos/${UPDATE_CONFIG.owner}/${UPDATE_CONFIG.repo}/releases/latest`
    )
  } catch (err) {
    // 404 = 还没有任何发行版 -> 视为「无更新」
    if (err instanceof Error && /404/.test(err.message)) return null
    throw err
  }
}

async function listAttachments(releaseId: number): Promise<GiteeAttachment[]> {
  return apiGet<GiteeAttachment[]>(
    `/repos/${UPDATE_CONFIG.owner}/${UPDATE_CONFIG.repo}/releases/${releaseId}/attach_files`
  )
}

async function downloadLatestYml(releaseId: number, attachmentId: number): Promise<string> {
  const res = await net.fetch(
    apiUrl(`/repos/${UPDATE_CONFIG.owner}/${UPDATE_CONFIG.repo}/releases/${releaseId}/attach_files/${attachmentId}/download`)
  )
  if (!res.ok) throw new Error(`下载 latest.yml 失败 HTTP ${res.status}`)
  return res.text()
}

function parseTagVersion(tag: string): string | null {
  const v = tag.replace(/^v/i, '')
  return semver.valid(v) ? v : null
}

// ---------------- 对外接口 ----------------

/**
 * 检查更新：拉取最新发行版 -> 解析 latest.yml -> 版本比较 -> 自动下载安装包并校验。
 * 与旧 electron-updater 行为保持一致：available 后自动下载，事件通过广播发给渲染层。
 */
export async function checkForUpdates(): Promise<{ ok: boolean; message?: string }> {
  if (!app.isPackaged) {
    return { ok: false, message: '开发模式下无法检查更新，请使用打包后的安装程序' }
  }
  const { owner, repo, token } = UPDATE_CONFIG
  if (!owner || !repo || !token) {
    return { ok: false, message: '未配置 Gitee 更新仓库/令牌（src/main/updater-config.ts）' }
  }

  broadcast('checking', {})
  try {
    const release = await getLatestRelease()
    if (!release) {
      broadcast('not-available', {})
      return { ok: true }
    }

    const attachments = await listAttachments(release.id)
    const ymlAtt = attachments.find((a) => a.name === 'latest.yml')
    if (!ymlAtt) {
      throw new Error('最新发行版缺少 latest.yml，请使用 scripts/publish-gitee.ps1 发布')
    }

    const ymlText = await downloadLatestYml(release.id, ymlAtt.id)
    let info: LatestYml | null = null
    try {
      info = yaml.load(ymlText) as LatestYml
    } catch {
      /* fallthrough */
    }
    if (!info || typeof info !== 'object') throw new Error('latest.yml 解析失败')

    const remoteVersion = String(info.version || parseTagVersion(release.tag_name) || '')
    if (!semver.valid(remoteVersion)) {
      throw new Error(`发行版版本号无效：${remoteVersion}`)
    }

    const current = app.getVersion()
    if (!semver.gt(remoteVersion, current)) {
      broadcast('not-available', {})
      return { ok: true }
    }

    broadcast('available', { version: remoteVersion })

    // 取安装包文件名（electron-builder 生成的 latest.yml 使用 files[0].url）
    const file: UpdateFileInfo = (info.files && info.files[0]) || {
      url: info.path || '',
      sha512: info.sha512
    }
    const fileName = path.basename(file.url || '')
    if (!fileName) throw new Error('latest.yml 中缺少安装包文件名')
    const installerAtt = attachments.find((a) => a.name === fileName)
    if (!installerAtt) {
      throw new Error(`发行版缺少安装包附件：${fileName}`)
    }

    await fs.mkdir(updateDir, { recursive: true })
    const dest = path.join(updateDir, fileName)
    const { sha512 } = await downloadAttachment(release.id, installerAtt.id, dest, (percent) => {
      broadcast('progress', { percent })
    })

    if (file.sha512 && sha512 !== file.sha512) {
      await fs.unlink(dest).catch(() => {})
      throw new Error('安装包校验失败（sha512 不匹配），已删除损坏文件')
    }

    const state: UpdateState = {
      version: remoteVersion,
      installer: dest,
      downloadedAt: new Date().toISOString()
    }
    await fs.writeFile(path.join(updateDir, 'state.json'), JSON.stringify(state, null, 2), 'utf-8')

    broadcast('downloaded', { version: remoteVersion })
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    broadcast('error', { message })
    return { ok: false, message }
  }
}

/**
 * 安装已下载的更新：静默运行 NSIS 安装器（--updated /S --force-run，与 electron-updater 一致），
 * 然后立即退出应用，安装器完成安装后自动重启新版本。
 */
export async function installUpdate(): Promise<{ ok: boolean; message?: string }> {
  try {
    const statePath = path.join(updateDir, 'state.json')
    const raw = await fs.readFile(statePath, 'utf-8')
    const state = JSON.parse(raw) as UpdateState
    if (!state.installer) throw new Error('没有已下载的更新')

    const stat = await fs.stat(state.installer).catch(() => null)
    if (!stat || !stat.isFile()) throw new Error('更新安装包不存在，请重新检查更新')

    const child = spawn(state.installer, ['--updated', '/S', '--force-run'], {
      detached: true,
      stdio: 'ignore'
    })
    child.unref()
    // 立即退出，让安装器接管（NSIS 会等待本进程退出后覆盖文件并自动重启应用）
    app.exit(0)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
