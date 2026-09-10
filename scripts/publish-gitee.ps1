# =====================================================================
# 发布新版本到 Gitee（私密仓库）供「日志工具」自动更新使用
#
# 流程：
#   1) npm run build            （electron-vite 构建 out/）
#   2) electron-builder --win --publish never（打包 NSIS 安装包 + 生成 latest.yml）
#   3) 通过 Gitee API v5 创建/更新发行版 v<版本号>，并上传 latest.yml 与 setup.exe 附件
#
# 所需信息（三选一，推荐第 2 种）：
#   - 环境变量 GITEE_TOKEN / GITEE_OWNER / GITEE_REPO
#   - 已填写真实值的 src/main/updater-config.ts（发布脚本会自动读取）
#   - 仓库已存在（私密/公开均可；运行时下载需令牌，请保持私密即可）
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/publish-gitee.ps1
#   （或 npm run publish:gitee）
#   自定义发布说明：npm run publish:gitee -- -Message "自定义备注"
#   （不传 -Message 时自动读取 CHANGELOG.md 中对应版本的章节；都没有则用默认文案）
#
# 依赖：Node.js/npm、Windows PowerShell 5.1+（自带）或 PowerShell 7+。
# =====================================================================
param(
  # 可选：自定义发布说明（优先级：命令行 -Message 参数 > CHANGELOG.md > 默认文案）
  [string]$Message = ''
)
$ErrorActionPreference = 'Stop'
# PowerShell 7+ 下避免原生命令（npm 等）写 stderr 警告被当作终止错误
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

function Read-ConfigValue([string]$file, [string]$key) {
  if (-not (Test-Path $file)) { return $null }
  # 显式按 UTF-8 读取（避免 Windows PowerShell 按本地 ANSI/GBK 读取中文导致乱码）
  $text = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8)
  $m = [regex]::Match($text, "$key\s*:\s*'([^']*)'")
  if (-not $m.Success) { return $null }
  return $m.Groups[1].Value
}

# ---- 解析配置：环境变量优先，其次 updater-config.ts ----
$configFile = Join-Path $root 'src/main/updater-config.ts'
$owner  = if ($env:GITEE_OWNER)  { $env:GITEE_OWNER }  else { Read-ConfigValue $configFile 'owner' }
$repo   = if ($env:GITEE_REPO)   { $env:GITEE_REPO }   else { Read-ConfigValue $configFile 'repo' }
$token  = if ($env:GITEE_TOKEN)  { $env:GITEE_TOKEN }  else { Read-ConfigValue $configFile 'token' }
if (-not $owner)  { $owner = 'dadalia1' }
if (-not $repo)   { $repo = 'worklog' }
if (-not $token) {
  Write-Host '[错误] 未找到 Gitee 私人令牌。请设置环境变量 GITEE_TOKEN，或在 src/main/updater-config.ts 中填写 token。' -ForegroundColor Red
  exit 1
}

# ---- 版本号 ----
$pkgJson = [IO.File]::ReadAllText((Join-Path $root 'package.json'), [Text.Encoding]::UTF8)
$pkg = $pkgJson | ConvertFrom-Json
$version = $pkg.version
$tag = "v$version"
Write-Host "== 发布 $($pkg.name) v$version -> gitee.com/$owner/$repo (tag: $tag) ==" -ForegroundColor Cyan

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
# 优先精确匹配当前版本（artifactName: ${name}-${version}-setup.exe），避免误选历史产物
$exactName = "$($pkg.name)-$version-setup.exe"
$setupExe = Get-ChildItem -Path $distDir -Filter '*-setup.exe' | Where-Object { $_.Name -eq $exactName } | Select-Object -First 1
if (-not $setupExe) {
  $setupExe = Get-ChildItem -Path $distDir -Filter '*-setup.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if (-not (Test-Path $latestYml)) { Write-Host "[错误] 缺少 $latestYml，请检查 electron-builder.yml 的 publish 配置" -ForegroundColor Red; exit 1 }
if (-not $setupExe) { Write-Host '[错误] 未找到 dist 下的 setup.exe' -ForegroundColor Red; exit 1 }
Write-Host "   latest.yml: $latestYml"
Write-Host "   setup.exe : $($setupExe.FullName) ($([math]::Round($setupExe.Length/1MB,1)) MB)"

$apiBase = 'https://gitee.com/api/v5'
function Invoke-Gitee([string]$method, [string]$path, [object]$body = $null) {
  $uri = "$apiBase$path"
  $params = @{ Method = $method; Uri = $uri; UseBasicParsing = $true }
  if ($null -ne $body) {
    # 必须按 UTF-8 字节发送：PS 5.1 的 Invoke-WebRequest 字符串 Body 会按系统 ANSI(GBK)
    # 编码，中文发布说明上传后会变成乱码。先序列化 JSON，再编码为 UTF-8 字节数组发送。
    $params.Headers = @{ 'Content-Type' = 'application/json; charset=utf-8' }
    $params.Body = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 6))
  } else {
    # 追加 access_token 作为 query（multipart 上传时令牌走表单字段，不走这里）
    $params.Uri = "$uri$('?' + [uri]::EscapeDataString('access_token') + '=' + [uri]::EscapeDataString($token))"
  }
  return Invoke-WebRequest @params
}

# ---- 4) 创建/更新发行版 ----
Write-Host '[3/4] 创建/更新 Gitee 发行版...' -ForegroundColor Yellow
$release = $null
try {
  # 注意：Gitee 对不存在的 tag 返回 HTTP 200 + body null（而非 404）
  $r = Invoke-Gitee 'Get' "/repos/$owner/$repo/releases/tags/$tag"
  $parsed = $r.Content | ConvertFrom-Json
  if ($parsed -and $parsed.id) { $release = $parsed }
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
}
if ($release) {
  Write-Host "   发行版已存在 (id=$($release.id))，将重新上传附件"
} else {
  $body = @{
    access_token = $token
    tag_name = $tag
    name = "$($pkg.name) $version"
    body = (Get-ReleaseNotes -Version $version)
    target_commitish = 'master'
    prerelease = $false
  }
  $resp = Invoke-Gitee 'Post' "/repos/$owner/$repo/releases" $body
  $release = $resp.Content | ConvertFrom-Json
  Write-Host "   已创建发行版 (id=$($release.id))"
}
$releaseId = $release.id

# 删除旧附件（同名版本重复发布时避免残留/重复）
try {
  $atts = Invoke-Gitee 'Get' "/repos/$owner/$repo/releases/$releaseId/attach_files"
  foreach ($a in ($atts.Content | ConvertFrom-Json)) {
    $null = Invoke-Gitee 'Delete' "/repos/$owner/$repo/releases/$releaseId/attach_files/$($a.id)"
    Write-Host "   已删除旧附件: $($a.name)"
  }
} catch {
  # 无附件或列表失败，忽略
}

# ---- 5) 上传附件（multipart/form-data，兼容 PS 5.1）----
function New-MultipartBody([string]$filePath, [string]$fileName) {
  $boundary = '----WorkLogBoundary' + [guid]::NewGuid().ToString('N')
  $crlf = "`r`n"
  $fileBytes = [IO.File]::ReadAllBytes($filePath)
  $head = "--$boundary$crlf" +
    "Content-Disposition: form-data; name=`"file`"; filename=`"$fileName`"$crlf" +
    "Content-Type: application/octet-stream$crlf$crlf"
  $headBytes = [Text.Encoding]::UTF8.GetBytes($head)
  $tail = "$crlf--$boundary$crlf" +
    "Content-Disposition: form-data; name=`"access_token`"$crlf$crlf" +
    "$token$crlf--$boundary--$crlf"
  $tailBytes = [Text.Encoding]::UTF8.GetBytes($tail)
  $ms = New-Object IO.MemoryStream
  $ms.Write($headBytes, 0, $headBytes.Length)
  $ms.Write($fileBytes, 0, $fileBytes.Length)
  $ms.Write($tailBytes, 0, $tailBytes.Length)
  return @{ Boundary = $boundary; Bytes = $ms.ToArray() }
}

function Publish-Attachment([string]$filePath, [string]$fileName) {
  $m = New-MultipartBody $filePath $fileName
  $params = @{
    Method = 'Post'
    Uri = "$apiBase/repos/$owner/$repo/releases/$releaseId/attach_files"
    Headers = @{ 'Content-Type' = "multipart/form-data; boundary=$($m.Boundary)" }
    Body = $m.Bytes
    UseBasicParsing = $true
  }
  $resp = Invoke-WebRequest @params
  $att = $resp.Content | ConvertFrom-Json
  Write-Host "   上传成功: $($att.name) ($([math]::Round($att.size/1KB,1)) KB)"
}

Write-Host '[4/4] 上传附件...' -ForegroundColor Yellow
Publish-Attachment $latestYml 'latest.yml'
Publish-Attachment $setupExe.FullName $setupExe.Name

Write-Host ''
Write-Host '== 发布完成 ==' -ForegroundColor Green
Write-Host "   发行版: https://gitee.com/$owner/$repo/releases"
Write-Host "   版本  : $tag"
Write-Host '   安装旧版本后点击「设置 -> 关于系统 -> 检查更新」即可检测到本版本。'
exit 0
