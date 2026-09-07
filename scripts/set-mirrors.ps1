# One-time setup: persist Electron mirror env vars (User scope).
# - ELECTRON_MIRROR                  -> electron binary downloads via npmmirror during npm install
# - ELECTRON_BUILDER_BINARIES_MIRROR -> electron-builder binaries (winCodeSign/nsis...) via npmmirror
# NOTE: env vars only apply to NEW processes. Reopen your terminal after running this.
$ErrorActionPreference = 'Stop'

$targets = @(
  @{ Name = 'ELECTRON_MIRROR'; Value = 'https://npmmirror.com/mirrors/electron/' },
  @{ Name = 'ELECTRON_BUILDER_BINARIES_MIRROR'; Value = 'https://npmmirror.com/mirrors/electron-builder-binaries/' }
)

foreach ($t in $targets) {
  [Environment]::SetEnvironmentVariable($t.Name, $t.Value, 'User')
  Write-Host "Set user env: $($t.Name) = $($t.Value)"
}

Write-Host ''
Write-Host 'Done. Reopen your terminal, then run: npm install / npm run dev / npm run dist'
