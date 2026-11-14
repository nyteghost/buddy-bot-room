# Creates dist/PixelPals-Portable.zip: no installer, no registry, no elevation,
# NO build-machine credentials. Run after:
#   cargo build --release --locked --target x86_64-pc-windows-msvc
[CmdletBinding()]
param(
  [string]$Target = 'x86_64-pc-windows-msvc',
  # Exact source commit recorded in BUILD-INFO.txt (CI passes the PR head SHA).
  [string]$Commit = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$exe = Join-Path $root "target/$Target/release/PixelPals.exe"
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
  throw "Missing built exe $exe. Build with: cargo build --release --locked --target $Target"
}
if (-not $Commit) {
  $Commit = (& git -C $root rev-parse HEAD 2>$null)
  if (-not $Commit) { $Commit = 'UNKNOWN' }
}
$rustc = (& rustc --version 2>$null)
$dist = Join-Path $root 'dist'
$stage = Join-Path $dist 'PixelPals-Portable'
$zip = Join-Path $dist 'PixelPals-Portable.zip'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'Data') | Out-Null

Copy-Item -LiteralPath $exe -Destination (Join-Path $stage 'PixelPals.exe')
Copy-Item -LiteralPath (Join-Path $root 'README.md') -Destination (Join-Path $stage 'README.txt')
Copy-Item -LiteralPath (Join-Path $root 'QA-WINDOWS.md') -Destination $stage
Copy-Item -LiteralPath (Join-Path $root 'PERFORMANCE.md') -Destination $stage
# Read-only QA helpers for owner/independent hardware testing (not run automatically).
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'QA') | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'scripts/test-portable.ps1') -Destination (Join-Path $stage 'QA')
Copy-Item -LiteralPath (Join-Path $root 'scripts/profile-memory.ps1') -Destination (Join-Path $stage 'QA')
# Placeholder keeps Data/ in the archive (some ZIP tools drop empty folders).
@(
  'Pixel Pals portable data folder.',
  'settings.json and diagnostics are written here, beside PixelPals.exe.',
  'To update, replace ONLY PixelPals.exe and keep this folder.',
  'No passwords, tokens or account data are stored by this prototype.'
) | Set-Content -LiteralPath (Join-Path $stage 'Data/README.txt') -Encoding utf8

$exeHash = (Get-FileHash -LiteralPath (Join-Path $stage 'PixelPals.exe') -Algorithm SHA256).Hash
@(
  "PixelPals S4 portable prototype - NOT HARDWARE-ACCEPTED",
  "source_commit=$Commit",
  "target=$Target",
  "compiler=$rustc",
  "PixelPals.exe_sha256=$exeHash"
) | Set-Content -LiteralPath (Join-Path $stage 'BUILD-INFO.txt') -Encoding utf8

if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -LiteralPath $stage -DestinationPath $zip -CompressionLevel Optimal
$zipHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
"$zipHash  PixelPals-Portable.zip" | Set-Content -LiteralPath "$zip.sha256" -Encoding ascii
Write-Host "PixelPals.exe SHA256: $exeHash"
Write-Host "PixelPals-Portable.zip SHA256: $zipHash"
Write-Host "Windows artifact for QA (NOT YET HARDWARE-ACCEPTED): $zip"
