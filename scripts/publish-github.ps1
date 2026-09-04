# =====================================================================
# 发布新版本到 GitHub Releases 供「日志工具」更新使用
#
# 流程：
#   1) npm run build                    （electron-vite 构建 out/）
#   2) electron-builder --win --publish never（打包 NSIS 安装包 + latest.yml）
#   3) GitHub REST API：创建/更新发行版 v<版本号>，上传 latest.yml 与 setup.exe
#
# 所需环境变量（见 README / 注释）：
#   GH_TOKEN  GitHub Personal Access Token（classic，勾 repo 权限）
#   GH_OWNER  GitHub 用户名
#   GH_REPO   仓库名（如 worklog）
#
# 用法：npm run publish:github
#   自定义发布说明：npm run publish:github -- -Message "自定义备注"
#   （不传 -Message 时自动读取 CHANGELOG.md 中对应版本的章节；都没有则用默认文案）
# 依赖：Node.js/npm、Windows 10 1803+（自带 curl.exe）
# =====================================================================
param(
  # 可选：自定义发布说明（优先级：命令行 -Message 参数 > CHANGELOG.md > 默认文案）
  [string]$Message = ''
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 发布说明：-Message 参数 > CHANGELOG.md 对应版本章节 > 默认文案
function Get-ReleaseNotes([string]$Version) {
  if ($Message) { return $Message }
  $changelog = Join-Path $root 'CHANGELOG.md'
  if (Test-Path $changelog) {
    $text = [IO.File]::ReadAllText($changelog, [Text.Encoding]::UTF8)
    $pattern = "(?ms)^##\s*\[?v?" + [regex]::Escape($Version) + "\]?(?![-\w.])\s*(?:-\s*[^\r\n]*)?\r?\n(.+?)(?=^##\s|\z)"
    $m = [regex]::Match($text, $pattern)
    if ($m.Success) {
      $notes = $m.Groups[1].Value.Trim()
      if ($notes) { return $notes }
    }
  }
  return "日志工具 v$Version 自动更新发布"
}

# ---- 配置：环境变量 ----
$token = $env:GH_TOKEN
$owner = if ($env:GH_OWNER) { $env:GH_OWNER } else { 'dadalia1' }
$repo  = if ($env:GH_REPO)  { $env:GH_REPO }  else { 'WorkLog' }
if (-not $token) {
  Write-Host '[错误] 未找到 GitHub 令牌。请设置环境变量 GH_TOKEN（勾 repo 权限的 classic token）。' -ForegroundColor Red
  exit 1
}

# ---- 版本号 ----
$pkgJson = [IO.File]::ReadAllText((Join-Path $root 'package.json'), [Text.Encoding]::UTF8)
$pkg = $pkgJson | ConvertFrom-Json
$version = $pkg.version
$tag = "v$version"
$apiBase = 'https://api.github.com'
Write-Host "== 发布 $($pkg.name) v$version -> github.com/$owner/$repo (tag: $tag) ==" -ForegroundColor Cyan

# ---- curl 封装（JSON 接口；NoFail 用于“查询是否存在”，允许 404）----
function Invoke-GitHubApi {
  param(
    [Parameter(Mandatory=$true)][string]$Method,
    [Parameter(Mandatory=$true)][string]$Url,
    [object]$Body = $null,
    [switch]$NoFail
  )
  $curlArgs = @('--silent','--show-error','--ssl-no-revoke','-X',$Method,
                '-H',"Authorization: Bearer $token",
                '-H','Accept: application/vnd.github+json')
  $tmpJson = $null
  if ($null -ne $Body) {
    # 避免把含中文/引号/空格的 JSON 内联传给 curl（PS 5.1 原生参数传递会拆坏引号，
    # 导致 body 片段被 curl 误当成 URL）。写入临时文件，用 --data-binary @file 传 body。
    # 注意：PowerShell 5.1 的 [Text.Encoding]::UTF8 写文件带 BOM，GitHub 的 JSON 解析器
    # 会拒绝（400 Problems parsing JSON），必须用不带 BOM 的 UTF8 编码写临时文件。
    $tmpJson = [IO.Path]::GetTempFileName()
    [IO.File]::WriteAllText($tmpJson, ($Body | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($false)))
    $curlArgs += @('-H','Content-Type: application/json','--data-binary',"@$tmpJson")
  }
  if (-not $NoFail) { $curlArgs = @('--fail') + $curlArgs }
  $curlArgs += $Url
  # PS 5.1 下 curl 写 stderr 在 ErrorActionPreference=Stop 时会被转成终止错误直接掐断脚本，
  # 这里临时改为 Continue，让 stderr 只进 $out，统一用 $LASTEXITCODE 判断成败。
  $prevEAP = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = & curl.exe @curlArgs 2>&1
  $exit = $LASTEXITCODE
  $ErrorActionPreference = $prevEAP
  if ($tmpJson) { Remove-Item $tmpJson -Force -ErrorAction SilentlyContinue }
  if ($exit -ne 0) {
    throw "GitHub API $Method $Url 失败 (exit=$exit): $(($out | Out-String).Trim())"
  }
  $text = ($out | Out-String).Trim()
  if (-not $text) { return $null }
  return ($text | ConvertFrom-Json)
}

# ---- 1) 构建 ----
Write-Host '[1/4] electron-vite 构建...' -ForegroundColor Yellow
& npm run build
if ($LASTEXITCODE -ne 0) { Write-Host '[错误] 构建失败' -ForegroundColor Red; exit 1 }

# ---- 2) 打包 ----
Write-Host '[2/4] electron-builder 打包 NSIS 安装包...' -ForegroundColor Yellow
& npx electron-builder --win --publish never
if ($LASTEXITCODE -ne 0) { Write-Host '[错误] 打包失败' -ForegroundColor Red; exit 1 }

# ---- 3) 校验产物 ----
$distDir = Join-Path $root 'dist'
$latestYml = Join-Path $distDir 'latest.yml'
$exactName = "$($pkg.name)-$version-setup.exe"
$setupExe = Get-ChildItem -Path $distDir -Filter '*-setup.exe' | Where-Object { $_.Name -eq $exactName } | Select-Object -First 1
if (-not $setupExe) {
  $setupExe = Get-ChildItem -Path $distDir -Filter '*-setup.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if (-not (Test-Path $latestYml)) { Write-Host "[错误] 缺少 $latestYml" -ForegroundColor Red; exit 1 }
if (-not $setupExe) { Write-Host '[错误] 未找到 dist 下的 setup.exe' -ForegroundColor Red; exit 1 }
Write-Host "   latest.yml: $latestYml"
Write-Host "   setup.exe : $($setupExe.FullName) ($([math]::Round($setupExe.Length/1MB,1)) MB)"

# ---- 4) 创建/更新发行版 ----
Write-Host '[3/4] 创建/更新 GitHub 发行版...' -ForegroundColor Yellow
$release = $null
try {
  $existing = Invoke-GitHubApi -Method 'GET' -Url "$apiBase/repos/$owner/$repo/releases/tags/$tag" -NoFail
  if ($existing -and $existing.id) { $release = $existing }
} catch {
  # 404 = 发行版尚不存在，属预期，继续创建新发行版
}
if ($release) {
  Write-Host "   发行版已存在 (id=$($release.id))，将重新上传附件"
} else {
  $body = @{
    tag_name = $tag
    name = "$($pkg.name) $version"
    body = (Get-ReleaseNotes -Version $version)
    target_commitish = 'master'
    draft = $false
    prerelease = $false
  }
  $release = Invoke-GitHubApi -Method 'POST' -Url "$apiBase/repos/$owner/$repo/releases" -Body $body
  Write-Host "   已创建发行版 (id=$($release.id))"
}

# 删除旧附件（同名版本重复发布时避免残留/重复）
$assets = Invoke-GitHubApi -Method 'GET' -Url $release.assets_url
if ($assets) {
  foreach ($a in $assets) {
    Invoke-GitHubApi -Method 'DELETE' -Url $a.url | Out-Null
    Write-Host "   已删除旧附件: $($a.name)"
  }
}

# ---- 5) 上传附件（octet-stream 二进制，curl 流式上传）----
function Publish-Asset([string]$filePath, [string]$fileName) {
  $uploadBase = $release.upload_url -replace '\{[^}]*\}', ''
  $uploadUrl = "$uploadBase" + '?name=' + [uri]::EscapeDataString($fileName)
  $curlArgs = @('--silent','--show-error','--ssl-no-revoke','--fail','-X','POST',
                '-H',"Authorization: Bearer $token",
                '-H','Content-Type: application/octet-stream',
                '-H','Accept: application/vnd.github+json',
                '--data-binary',"@$filePath",
                $uploadUrl)
  $prevEAP = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = & curl.exe @curlArgs 2>&1
  $exit = $LASTEXITCODE
  $ErrorActionPreference = $prevEAP
  if ($exit -ne 0) {
    throw "上传 $fileName 失败 (exit=$exit): $(($out | Out-String).Trim())"
  }
  $att = ($out | Out-String).Trim() | ConvertFrom-Json
  Write-Host "   上传成功: $($att.name) ($([math]::Round($att.size/1KB,1)) KB)"
}

Write-Host '[4/4] 上传附件...' -ForegroundColor Yellow
Publish-Asset $latestYml 'latest.yml'
Publish-Asset $setupExe.FullName $setupExe.Name

Write-Host ''
Write-Host '== 发布完成 ==' -ForegroundColor Green
Write-Host "   发行版: https://github.com/$owner/$repo/releases"
Write-Host "   版本  : $tag"
exit 0