# Creates a portable ZIP with no installer and NO build-machine credentials.
[CmdletBinding()]
param([string]$Target = 'x86_64-pc-windows-msvc')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$exe = Join-Path $root "target/$Target/release/PixelPals.exe"
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
  throw "Missing built exe $exe. Build with cargo build --release --target $Target on authorized Windows build host."
}
$dist = Join-Path $root 'dist'
$stage = Join-Path $dist 'PixelPals-Portable'
$zip = Join-Path $dist 'PixelPals-Portable.zip'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'Data') | Out-Null
Copy-Item -LiteralPath $exe -Destination (Join-Path $stage 'PixelPals.exe')
Copy-Item -LiteralPath (Join-Path $root 'README.md') -Destination (Join-Path $stage 'README.txt')
Copy-Item -LiteralPath (Join-Path $root 'QA-WINDOWS.md') -Destination $stage
Copy-Item -LiteralPath (Join-Path $root 'PERFORMANCE.md') -Destination $stage
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -LiteralPath $stage -DestinationPath $zip -CompressionLevel Optimal
Write-Host "Windows artifact to QA (NOT YET ACCEPTED): $zip"
