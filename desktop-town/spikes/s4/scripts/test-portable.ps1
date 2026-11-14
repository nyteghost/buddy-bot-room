# Run only on an approved unprivileged Windows 11 test machine after extraction.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ExtractedFolder)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $ExtractedFolder 'PixelPals.exe'
$data = Join-Path $ExtractedFolder 'Data'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'PixelPals.exe missing' }
New-Item -ItemType Directory -Path $data -Force | Out-Null
$p = Start-Process -FilePath $exe -ArgumentList '--self-test' -Wait -PassThru -NoNewWindow
if ($p.ExitCode -ne 0) { throw "Portable persistence self-test FAILED: $($p.ExitCode)" }
Write-Host 'PASS: executable self-test launched and portable persistence roundtrip completed'
Write-Host 'PENDING: real fullscreen, overlay, DPI, OS click-through, GPU and CPU manual QA'
