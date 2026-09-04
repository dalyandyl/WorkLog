// 自动更新（Gitee / GitHub 双通道镜像源）
//
// 背景：Gitee 不提供 electron-updater 官方发布源，实测可用的是 Gitee API v5：
//   - GET /repos/{owner}/{repo}/releases/latest            -> 最新发行版（含附件名）
//   - GET /repos/{owner}/{repo}/releases/{id}/attach_files  -> 附件列表（含 id）
//   - GET /repos/{owner}/{repo}/releases/{id}/attach_files/{fileId}/download
//                                                        -> 附件内容（带 access_token）
// GitHub 公开仓库可直接用 Releases API + 附件直链（免令牌）：
//   - GET https://api.github.com/repos/{owner}/{repo}/releases/latest
//   - 附件直链 https://github.com/{owner}/{repo}/releases/download/{tag}/{file}
//
// 用户可在设置页选择镜像源（自动 / Gitee / GitHub）；「自动」= Gitee 优先，
// 失败或无结果时回退 GitHub。检测 -> 下载 -> 校验 -> 安装 全流程与渲染层事件兼容。
import { app, net } from 'electron'
import { createWriteStream } from 'fs'
import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'
import yaml from 'js-yaml'
import semver from 'semver'
import { UPDATE_CONFIG } from './updater-config'
import type { UpdateSource } from '../shared/types'

export type UpdateBroadcast = (channel: string, payload: unknown) => void

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

interface GiteeRelease {
  id: number
  tag_name: string
  name?: string | null
}

interface GiteeAttachment {
  id: number
  name: string
  size?: number
}

interface GithubRelease {
  tag_name: string
  assets?: { name: string; browser_download_url: string }[]
}

/** 已解析出的可下载计划：Gitee/GitHub 统一为「直链 + sha512」 */
interface UpdatePlan {
  remoteVersion: string
  fileName: string
  installerUrl: string
  sha512?: string
}

interface UpdateState {
  version: string
  installer: string
  downloadedAt: string
}

type ChannelId = 'gitee' | 'github'

let broadcast: UpdateBroadcast = () => {}
let updateDir = ''

/** 当前生效的镜像源（由设置页切换，持久化在 settings.json） */
let currentSource: UpdateSource = 'auto'

export function setUpdateSource(source: UpdateSource): void {
  currentSource = source
}

/** 注册更新事件广播（由主进程在窗口创建后调用） */
export function initUpdater(cb: UpdateBroadcast): void {
  broadcast = cb
  updateDir = path.join(app.getPath('temp'), 'worklog-update')
}

// ---------------- 配置 ----------------

function channelCfg(id: ChannelId): { owner: string; repo: string; token: string } {
  const c = (UPDATE_CONFIG as Record<string, { owner?: string; repo?: string; token?: string }>)[id]
  return { owner: c?.owner ?? '', repo: c?.repo ?? '', token: c?.token ?? '' }
}

// ---------------- 公共解析 ----------------

function parseTagVersion(tag: string): string | null {
  const v = tag.replace(/^v/i, '')
  return semver.valid(v) ? v : null
}

function parseLatestYml(text: string): LatestYml {
  let info: LatestYml | null = null
  try {
    info = yaml.load(text) as LatestYml
  } catch {
    /* fallthrough */
  }
  if (!info || typeof info !== 'object') throw new Error('latest.yml 解析失败')
  return info
}

/** 从 latest.yml 取安装包文件名（electron-builder 生成的 latest.yml 使用 files[0].url） */
function installerFromYml(info: LatestYml): { fileName: string; sha512?: string } {
  const file: UpdateFileInfo = (info.files && info.files[0]) || {
    url: info.path || '',
    sha512: info.sha512
  }
  const fileName = path.basename(file.url || '')
  if (!fileName) throw new Error('latest.yml 中缺少安装包文件名')
  return { fileName, sha512: file.sha512 }
}

/** 比较远端版本是否高于当前安装版本；版本号非法则抛错 */
function isNewer(remoteVersion: string): boolean {
  if (!semver.valid(remoteVersion)) throw new Error(`发行版版本号无效：${remoteVersion}`)
  return semver.gt(remoteVersion, app.getVersion())
}

// ---------------- 流式下载（两通道共用） ----------------

async function streamDownload(
  url: string,
  dest: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  const res = await net.fetch(url)
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
  return hash.digest('base64')
}

// ---------------- Gitee 通道 ----------------

function giteeApiUrl(pathname: string): string {
  const token = channelCfg('gitee').token
  const sep = pathname.includes('?') ? '&' : '?'
  return `https://gitee.com/api/v5${pathname}${sep}access_token=${encodeURIComponent(token)}`
}

async function giteeApiGet<T>(pathname: string): Promise<T> {
  const res = await net.fetch(giteeApiUrl(pathname))
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

async function giteeFetchText(url: string): Promise<string> {
  const res = await net.fetch(url)
  if (!res.ok) throw new Error(`下载 latest.yml 失败 HTTP ${res.status}`)
  return res.text()
}

async function giteeGetPlan(): Promise<UpdatePlan | null> {
  const { owner, repo, token } = channelCfg('gitee')
  if (!owner || !repo || !token) {
    throw new Error('未配置 Gitee 更新仓库/令牌（src/main/updater-config.ts）')
  }

  let release: GiteeRelease
  try {
    release = await giteeApiGet<GiteeRelease>(`/repos/${owner}/${repo}/releases/latest`)
  } catch (err) {
    // 404 = 还没有任何发行版 -> 视为「无更新」
    if (err instanceof Error && /404/.test(err.message)) return null
    throw err
  }

  const attachments = await giteeApiGet<GiteeAttachment[]>(
    `/repos/${owner}/${repo}/releases/${release.id}/attach_files`
  )
  const ymlAtt = attachments.find((a) => a.name === 'latest.yml')
  if (!ymlAtt) {
    throw new Error('最新发行版缺少 latest.yml，请使用 scripts/publish-gitee.ps1 发布')
  }

  const info = parseLatestYml(
    await giteeFetchText(
      giteeApiUrl(
        `/repos/${owner}/${repo}/releases/${release.id}/attach_files/${ymlAtt.id}/download`
      )
    )
  )
  const remoteVersion = String(info.version || parseTagVersion(release.tag_name) || '')
  if (!isNewer(remoteVersion)) return null

  const { fileName, sha512 } = installerFromYml(info)
  const installerAtt = attachments.find((a) => a.name === fileName)
  if (!installerAtt) {
    throw new Error(`发行版缺少安装包附件：${fileName}`)
  }

  return {
    remoteVersion,
    fileName,
    installerUrl: giteeApiUrl(
      `/repos/${owner}/${repo}/releases/${release.id}/attach_files/${installerAtt.id}/download`
    ),
    sha512
  }
}

// ---------------- GitHub 通道 ----------------

async function githubApiJson(url: string): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  const token = channelCfg('github').token
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await net.fetch(url, { headers })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 200)
    } catch {
      /* ignore */
    }
    throw new Error(`GitHub API HTTP ${res.status}：${detail || res.statusText}`)
  }
  return res.json()
}

async function githubGetPlan(): Promise<UpdatePlan | null> {
  const { owner, repo } = channelCfg('github')
  if (!owner || !repo) {
    throw new Error('未配置 GitHub 更新仓库（src/main/updater-config.ts）')
  }

  let release: GithubRelease
  try {
    release = (await githubApiJson(
      `https://api.github.com/repos/${owner}/${repo}/releases/latest`
    )) as GithubRelease
  } catch (err) {
    // 404 = 还没有任何发行版 -> 视为「无更新」
    if (err instanceof Error && /404/.test(err.message)) return null
    throw err
  }

  const assets = release.assets ?? []
  const ymlAsset = assets.find((a) => a.name === 'latest.yml')
  if (!ymlAsset) {
    throw new Error('最新发行版缺少 latest.yml，请先发布 GitHub Release')
  }

  const ymlRes = await net.fetch(ymlAsset.browser_download_url)
  if (!ymlRes.ok) throw new Error(`下载 latest.yml 失败 HTTP ${ymlRes.status}`)
  const info = parseLatestYml(await ymlRes.text())

  const remoteVersion = String(info.version || parseTagVersion(release.tag_name) || '')
  if (!isNewer(remoteVersion)) return null

  const { fileName, sha512 } = installerFromYml(info)
  const installerAsset = assets.find((a) => a.name === fileName)
  if (!installerAsset) {
    throw new Error(`发行版缺少安装包附件：${fileName}`)
  }

  return {
    remoteVersion,
    fileName,
    installerUrl: installerAsset.browser_download_url,
    sha512
  }
}

// ---------------- 源选择与统一入口 ----------------

function channelsFor(source: UpdateSource): { id: ChannelId; getPlan: () => Promise<UpdatePlan | null> }[] {
  switch (source) {
    case 'gitee':
      return [{ id: 'gitee', getPlan: giteeGetPlan }]
    case 'github':
      return [{ id: 'github', getPlan: githubGetPlan }]
    default: // auto
      return [
        { id: 'gitee', getPlan: giteeGetPlan },
        { id: 'github', getPlan: githubGetPlan }
      ]
  }
}

/**
 * 按当前镜像源解析「本次可更新」计划。
 * - 单源：该源出错则抛错；无更新返回 null。
 * - 自动：按 Gitee -> GitHub 依次尝试；命中即返回；全部无更新返回 null；全部出错抛最后错误。
 */
async function resolveUpdatePlan(): Promise<{ plan: UpdatePlan | null; source: ChannelId | null }> {
  const chains = channelsFor(currentSource)
  let lastError: Error | null = null
  for (const ch of chains) {
    try {
      const plan = await ch.getPlan()
      if (plan) return { plan, source: ch.id }
      lastError = null // 该源确认无更新，正常继续尝试下一个源
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  if (lastError) throw lastError
  return { plan: null, source: null }
}

// ---------------- 对外接口 ----------------

/**
 * 检查更新：仅检测并广播 available/not-available，不自动下载。
 * 由渲染层弹窗询问用户是否更新，确认后再调用 downloadUpdate()。
 */
export async function checkForUpdates(): Promise<{ ok: boolean; message?: string }> {
  if (!app.isPackaged) {
    return { ok: false, message: '开发模式下无法检查更新，请使用打包后的安装程序' }
  }
  broadcast('checking', {})
  try {
    const { plan, source } = await resolveUpdatePlan()
    if (!plan) {
      broadcast('not-available', {})
      return { ok: true }
    }
    broadcast('available', { version: plan.remoteVersion, source })
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    broadcast('error', { message })
    return { ok: false, message }
  }
}

/**
 * 下载已确认的更新：流式下载安装包 -> sha512 校验 -> 保存状态 -> 广播 downloaded。
 */
export async function downloadUpdate(): Promise<{ ok: boolean; message?: string }> {
  if (!app.isPackaged) {
    return { ok: false, message: '开发模式下无法下载更新，请使用打包后的安装程序' }
  }
  try {
    const { plan } = await resolveUpdatePlan()
    if (!plan) {
      broadcast('not-available', {})
      return { ok: true }
    }

    await fs.mkdir(updateDir, { recursive: true })
    const dest = path.join(updateDir, plan.fileName)
    const sha512 = await streamDownload(plan.installerUrl, dest, (percent) => {
      broadcast('progress', { percent })
    })

    if (plan.sha512 && sha512 !== plan.sha512) {
      await fs.unlink(dest).catch(() => {})
      throw new Error('安装包校验失败（sha512 不匹配），已删除损坏文件')
    }

    const state: UpdateState = {
      version: plan.remoteVersion,
      installer: dest,
      downloadedAt: new Date().toISOString()
    }
    await fs.writeFile(path.join(updateDir, 'state.json'), JSON.stringify(state, null, 2), 'utf-8')

    broadcast('downloaded', { version: plan.remoteVersion })
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    broadcast('error', { message })
    return { ok: false, message }
  }
}

/**
 * 安装已下载的更新：启动 NSIS 安装器（--updated --force-run，去掉静默 /S，
 * 让安装程序界面正常显示），然后立即退出应用，由安装器接管并自动重启新版本。
 */
export async function installUpdate(): Promise<{ ok: boolean; message?: string }> {
  try {
    const statePath = path.join(updateDir, 'state.json')
    const raw = await fs.readFile(statePath, 'utf-8')
    const state = JSON.parse(raw) as UpdateState
    if (!state.installer) throw new Error('没有已下载的更新')

    const stat = await fs.stat(state.installer).catch(() => null)
    if (!stat || !stat.isFile()) throw new Error('更新安装包不存在，请重新检查更新')

    const child = spawn(state.installer, ['--updated', '--force-run'], {
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
