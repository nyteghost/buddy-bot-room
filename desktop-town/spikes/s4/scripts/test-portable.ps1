# Automated portable smoke test for an EXTRACTED PixelPals-Portable folder.
# Proves (on the machine it runs on): static binary checks, headless Data/
# round-trip, real overlay launch + presented frames, settings persistence
# across restarts, Data/ preservation after executable replacement, fail-closed
# corrupt settings, read-only Data/ handling and usage errors.
# It does NOT prove OS click-through, focus, DPI, fullscreen or GPU behaviour on
# real hardware: see QA-WINDOWS.md. Never run on managed work hardware without
# IT approval.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ExtractedFolder,
  [int]$SmokeMs = 4000,
  # Skip tests that create a window (headless/service sessions).
  [switch]$NoGui,
  # Optional JSON results file for CI evidence.
  [string]$ResultsPath = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$folder = (Resolve-Path -LiteralPath $ExtractedFolder).Path
$exe = Join-Path $folder 'PixelPals.exe'
$data = Join-Path $folder 'Data'
$settings = Join-Path $data 'settings.json'
$results = [System.Collections.Generic.List[object]]::new()
$script:aclDenied = $null

function Add-Result([string]$Name, [string]$Status, [string]$Detail) {
  $results.Add([pscustomobject]@{ test = $Name; status = $Status; detail = $Detail })
  Write-Host ("[{0}] {1} - {2}" -f $Status, $Name, $Detail)
}

function Invoke-Pals([string[]]$Arguments, [int]$TimeoutMs = 120000) {
  $p = Start-Process -FilePath $exe -ArgumentList $Arguments -WorkingDirectory $folder -PassThru `
    -RedirectStandardError (Join-Path $env:TEMP 'pals-stderr.txt') `
    -RedirectStandardOutput (Join-Path $env:TEMP 'pals-stdout.txt')
  $null = $p.Handle  # cache handle so ExitCode is available after exit
  if (-not $p.WaitForExit($TimeoutMs)) {
    $p.Kill()
    throw "PixelPals.exe $Arguments did not exit within $TimeoutMs ms"
  }
  $p.WaitForExit()
  return $p.ExitCode
}

# External observer: watches the overlay HWND from another process while the
# executable runs, sampling visibility and window-region type every ~5 ms.
# Region types: 0 = no region (whole window), 1 = empty, 2/3 = Pal silhouette.
Add-Type -Namespace S4Qa -Name Win32 -MemberDefinition @'
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern System.IntPtr FindWindowW(string className, string title);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool IsWindowVisible(System.IntPtr hwnd);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern int GetWindowRgnBox(System.IntPtr hwnd, out RECT rect);
'@
$OverlayTitle = 'Pixel Pals S4 prototype'

function Invoke-PalsWatched([string[]]$Arguments, [int]$TimeoutMs = 120000) {
  $p = Start-Process -FilePath $exe -ArgumentList $Arguments -WorkingDirectory $folder -PassThru `
    -RedirectStandardError (Join-Path $env:TEMP 'pals-stderr.txt') `
    -RedirectStandardOutput (Join-Path $env:TEMP 'pals-stdout.txt')
  $null = $p.Handle
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $found = $false; $everVisible = $false; $palRegion = $false; $unsafe = 0; $samples = 0
  while (-not $p.HasExited) {
    if ($watch.ElapsedMilliseconds -gt $TimeoutMs) { $p.Kill(); throw "PixelPals.exe $Arguments did not exit within $TimeoutMs ms" }
    # [NullString]::Value: PowerShell would otherwise pass "" (match no class).
    $hwnd = [S4Qa.Win32]::FindWindowW([NullString]::Value, $OverlayTitle)
    if ($hwnd -ne [System.IntPtr]::Zero) {
      $found = $true; $samples++
      $rect = New-Object S4Qa.Win32+RECT
      $type = [S4Qa.Win32]::GetWindowRgnBox($hwnd, [ref]$rect)
      $visible = [S4Qa.Win32]::IsWindowVisible($hwnd)
      if ($type -ge 2) { $palRegion = $true }
      if ($visible) {
        $everVisible = $true
        # A visible overlay must always carry the Pal-shaped region.
        if ($type -lt 2) { $unsafe++ }
      }
    }
    Start-Sleep -Milliseconds 5
  }
  $p.WaitForExit()
  return [pscustomobject]@{
    ExitCode = $p.ExitCode; WindowSeen = $found; EverVisible = $everVisible
    PalRegionSeen = $palRegion; VisibleWithoutPalRegion = $unsafe; Samples = $samples
  }
}

function Read-Smoke {
  $smoke = Join-Path $data 's4-smoke.json'
  if (Test-Path -LiteralPath $smoke) { return Get-Content -LiteralPath $smoke -Raw | ConvertFrom-Json }
  return $null
}

function Write-Settings([int]$Clicks) {
  $json = @{ version = 1; pal_x = 123; pal_y = 150; pal_clicks = $Clicks; animate = $false } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($settings, $json)
}

function Get-Clicks { return [int64]((Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json).pal_clicks) }

# Minimal PE32+ import-table reader: lists DLLs the loader must resolve at
# start-up (no dumpbin/Visual Studio needed on the QA machine).
function Get-PeImports([byte[]]$Pe) {
  $pe32 = [BitConverter]::ToInt32($Pe, 0x3C)
  if ([BitConverter]::ToUInt32($Pe, $pe32) -ne 0x4550) { throw 'not a PE file' }
  $coff = $pe32 + 4
  $sections = [BitConverter]::ToUInt16($Pe, $coff + 2)
  $optSize = [BitConverter]::ToUInt16($Pe, $coff + 16)
  $opt = $coff + 20
  if ([BitConverter]::ToUInt16($Pe, $opt) -ne 0x20B) { throw 'not PE32+ (x64)' }
  $importRva = [BitConverter]::ToUInt32($Pe, $opt + 112 + 8)  # data directory 1
  $table = $opt + $optSize
  $toOffset = {
    param([uint32]$Rva)
    for ($i = 0; $i -lt $sections; $i++) {
      $h = $table + 40 * $i
      $va = [BitConverter]::ToUInt32($Pe, $h + 12)
      $size = [Math]::Max([BitConverter]::ToUInt32($Pe, $h + 8), [BitConverter]::ToUInt32($Pe, $h + 16))
      if ($Rva -ge $va -and $Rva -lt $va + $size) { return [int]($Rva - $va + [BitConverter]::ToUInt32($Pe, $h + 20)) }
    }
    throw "RVA $Rva outside sections"
  }
  $names = @()
  if ($importRva -eq 0) { return $names }
  $d = & $toOffset $importRva
  while ($true) {
    $nameRva = [BitConverter]::ToUInt32($Pe, $d + 12)
    if ($nameRva -eq 0) { break }
    $o = & $toOffset $nameRva
    $end = [Array]::IndexOf($Pe, [byte]0, $o)
    $names += [System.Text.Encoding]::ASCII.GetString($Pe, $o, $end - $o)
    $d += 20
  }
  return $names
}

function Assert-True([bool]$Condition, [string]$Name, [string]$Detail) {
  if ($Condition) { Add-Result $Name 'PASS' $Detail } else { Add-Result $Name 'FAIL' $Detail }
}

try {
  # 1. Static package checks -------------------------------------------------
  Assert-True (Test-Path -LiteralPath $exe -PathType Leaf) 'exe-present' $exe
  $bytes = [System.IO.File]::ReadAllBytes($exe)
  $ascii = [System.Text.Encoding]::ASCII.GetString($bytes)
  Assert-True ($ascii.Contains('asInvoker') -and -not $ascii.Contains('requireAdministrator') -and -not $ascii.Contains('highestAvailable')) `
    'manifest-asInvoker' 'embedded manifest requests asInvoker, never elevation'
  Assert-True ($ascii.Contains('PerMonitorV2')) 'manifest-dpi' 'embedded manifest declares PerMonitorV2'
  $imports = @(Get-PeImports $bytes)
  Add-Result 'pe-imports' 'INFO' ($imports -join ',')
  $nonOs = @($imports | Where-Object { $_ -match '^(vcruntime|msvcp|ucrtbase|api-ms-win-crt|dxcompiler|dxil|WebView2Loader)' })
  Assert-True ($imports.Count -gt 0 -and $nonOs.Count -eq 0) 'no-redistributable-imports' `
    ("static imports outside Windows itself: " + $(if ($nonOs.Count) { $nonOs -join ',' } else { 'none' }) + " (d3d12/dxgi/dcomp/d3dcompiler_47 are loaded at runtime from Windows)")
  $unexpected = Get-ChildItem -LiteralPath $folder -Recurse -File | Where-Object {
    $_.Name -notin @('PixelPals.exe', 'README.txt', 'QA-WINDOWS.md', 'PERFORMANCE.md', 'BUILD-INFO.txt') -and
    -not ($_.DirectoryName -eq $data)
  }
  Assert-True (@($unexpected).Count -eq 0) 'package-contents' ("unexpected files: " + (@($unexpected | ForEach-Object Name) -join ','))
  $secretHits = Get-ChildItem -LiteralPath $folder -Recurse -File -Exclude '*.exe' | Select-String -Pattern '(?i)(password|api[_-]?key|secret|token)\s*[:=]' -List
  Assert-True (@($secretHits).Count -eq 0) 'no-plaintext-secrets' 'no credential-looking assignments in package text files'

  # 2. Usage errors fail explicitly ------------------------------------------
  $code = Invoke-Pals @('--definitely-not-a-flag')
  Assert-True ($code -eq 2) 'unknown-argument-exit-2' "exit=$code"

  # 3. Headless Data/ round-trip -------------------------------------------
  New-Item -ItemType Directory -Force -Path $data | Out-Null
  $code = Invoke-Pals @('--self-test')
  Assert-True ($code -eq 0) 'self-test' "exit=$code"
  Assert-True (-not (Get-ChildItem -LiteralPath $data -Directory -Filter 's4-self-test-*')) 'self-test-cleanup' 'isolated self-test folder removed'

  if ($NoGui) {
    Add-Result 'gui-smoke' 'SKIPPED' '-NoGui requested'
  } else {
    # 4. Real overlay launch, presented frames, persistence across restarts --
    Write-Settings 7
    $code = Invoke-Pals @("--smoke-test-ms=$SmokeMs", '--smoke-click')
    $smoke = Join-Path $data 's4-smoke.json'
    $report = if (Test-Path -LiteralPath $smoke) { Get-Content -LiteralPath $smoke -Raw | ConvertFrom-Json } else { $null }
    Assert-True ($code -eq 0 -and $report -and $report.result -eq 'PASS' -and $report.frames_presented -ge 1) 'overlay-launch-presents-frames' `
      ("exit=$code " + $(if ($report) { "backend=$($report.backend) adapter=$($report.adapter) type=$($report.device_type) alpha=$($report.alpha_mode) format=$($report.format) frames=$($report.frames_presented) scale=$($report.scale)" } else { 'no s4-smoke.json' }))
    Assert-True ($report -and $report.alpha_mode -match 'Multiplied') 'transparent-swapchain' $(if ($report) { "alpha_mode=$($report.alpha_mode)" } else { 'no report' })
    Assert-True ((Get-Clicks) -eq 8) 'persist-run-1' "pal_clicks=$(Get-Clicks) (expected 8)"
    $code = Invoke-Pals @("--smoke-test-ms=$SmokeMs", '--smoke-click')
    Assert-True ($code -eq 0 -and (Get-Clicks) -eq 9) 'persist-across-restart' "exit=$code pal_clicks=$(Get-Clicks) (expected 9)"

    # 5. Executable replacement keeps Data/ ---------------------------------
    $before = (Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash
    $replacement = Join-Path $env:TEMP "PixelPals-replacement-$PID.exe"
    Copy-Item -LiteralPath $exe -Destination $replacement -Force
    Remove-Item -LiteralPath $exe -Force
    Copy-Item -LiteralPath $replacement -Destination $exe
    Remove-Item -LiteralPath $replacement -Force
    $after = (Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash
    $code = Invoke-Pals @("--smoke-test-ms=$SmokeMs", '--smoke-click')
    Assert-True ($before -eq $after -and $code -eq 0 -and (Get-Clicks) -eq 10) 'data-survives-exe-replacement' "exit=$code pal_clicks=$(Get-Clicks) (expected 10)"

    # 6. F5 first-frame safety on the real executable (QA fault injection) --
    #    Never-presenting surfaces must fail closed with exit 4 and the overlay
    #    must never become visible or receive a Pal input region.
    foreach ($kind in @('timeout', 'lost', 'outdated', 'fatal')) {
      $spec = if ($kind -eq 'fatal') { 'fatal:1' } else { "${kind}:never" }
      $before = (Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash
      Remove-Item -LiteralPath (Join-Path $data 's4-smoke.json') -ErrorAction SilentlyContinue
      $r = Invoke-PalsWatched @("--smoke-test-ms=$SmokeMs", "--qa-fault-first-frame=$spec")
      $report = Read-Smoke
      $after = (Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash
      # WindowSeen proves the observer really watched the (hidden) HWND.
      Assert-True ($r.ExitCode -eq 4 -and $r.WindowSeen -and -not $r.EverVisible -and -not $r.PalRegionSeen -and $report -and $report.result -eq 'FAIL_CLOSED_FIRST_FRAME' -and $before -eq $after) `
        "first-frame-$kind-fails-closed" ("exit=$($r.ExitCode) window_seen=$($r.WindowSeen) samples=$($r.Samples) ever_visible=$($r.EverVisible) pal_region=$($r.PalRegionSeen) attempts=$(if ($report) { $report.startup_attempts } else { 'n/a' }) settings_unchanged=$($before -eq $after)")
    }
    #    Transient skips recover: shown only after a real present, always with
    #    the Pal region, never visible with an empty/full-window region.
    foreach ($kind in @('timeout', 'lost', 'outdated')) {
      Remove-Item -LiteralPath (Join-Path $data 's4-smoke.json') -ErrorAction SilentlyContinue
      $r = Invoke-PalsWatched @("--smoke-test-ms=$SmokeMs", "--qa-fault-first-frame=${kind}:3")
      $report = Read-Smoke
      Assert-True ($r.ExitCode -eq 0 -and $report -and $report.result -eq 'PASS' -and $report.startup_attempts -eq 4 -and $r.WindowSeen -and $r.EverVisible -and $r.VisibleWithoutPalRegion -eq 0) `
        "first-frame-$kind-recovers" ("exit=$($r.ExitCode) attempts=$(if ($report) { $report.startup_attempts } else { 'n/a' }) frames=$(if ($report) { $report.frames_presented } else { 'n/a' }) ever_visible=$($r.EverVisible) visible_without_pal_region=$($r.VisibleWithoutPalRegion) samples=$($r.Samples)")
    }
    #    Unfaulted launch observed externally obeys the same invariant.
    $r = Invoke-PalsWatched @("--smoke-test-ms=$SmokeMs")
    $report = Read-Smoke
    Assert-True ($r.ExitCode -eq 0 -and $report.startup_attempts -ge 1 -and $r.WindowSeen -and $r.EverVisible -and $r.VisibleWithoutPalRegion -eq 0) `
      'normal-launch-never-visible-without-pal-region' "exit=$($r.ExitCode) attempts=$($report.startup_attempts) visible_without_pal_region=$($r.VisibleWithoutPalRegion) samples=$($r.Samples)"

    # 7. Corrupt settings fail closed and are not overwritten ---------------
    $good = [System.IO.File]::ReadAllBytes($settings)
    [System.IO.File]::WriteAllText($settings, '{no json}')
    $code = Invoke-Pals @("--smoke-test-ms=$SmokeMs")
    $kept = [System.IO.File]::ReadAllText($settings)
    Assert-True ($code -eq 1 -and $kept -eq '{no json}') 'corrupt-settings-fail-closed' "exit=$code file_unchanged=$($kept -eq '{no json}')"
    [System.IO.File]::WriteAllBytes($settings, $good)

    # 8. Unwritable Data/ runs read-only, never redirects or overwrites -----
    $acct = "$env:USERDOMAIN\$env:USERNAME"
    # Specific rights only: generic W would also deny SYNCHRONIZE and block reads.
    & icacls $data /deny "${acct}:(OI)(CI)(WD,AD,WEA,WA)" | Out-Null
    $script:aclDenied = $acct
    $canWrite = $true
    try { [System.IO.File]::WriteAllText((Join-Path $data "probe-$PID.txt"), 'x') } catch { $canWrite = $false }
    if ($canWrite) {
      Remove-Item -LiteralPath (Join-Path $data "probe-$PID.txt") -Force -ErrorAction SilentlyContinue
      & icacls $data /remove:d $acct | Out-Null
      $script:aclDenied = $null
      Add-Result 'read-only-data' 'SKIPPED' 'deny ACE did not block writes for this account (privileged runner)'
    } else {
      $before = (Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash
      $code = Invoke-Pals @("--smoke-test-ms=$SmokeMs", '--smoke-click')
      & icacls $data /remove:d $acct | Out-Null
      $script:aclDenied = $null
      $after = (Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash
      $appData = Get-ChildItem -LiteralPath $env:APPDATA, $env:LOCALAPPDATA -Directory -ErrorAction SilentlyContinue | Where-Object Name -match 'pixel'
      Assert-True ($code -eq 0 -and $before -eq $after -and -not $appData) 'read-only-data' "exit=$code settings_unchanged=$($before -eq $after) appdata_fallback=$([bool]$appData)"
    }
  }
} catch {
  Add-Result 'harness' 'FAIL' $_.Exception.Message
} finally {
  if ($script:aclDenied) { & icacls $data /remove:d $script:aclDenied | Out-Null }
}

if ($ResultsPath) { $results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ResultsPath -Encoding utf8 }
$failed = @($results | Where-Object status -eq 'FAIL')
Write-Host ''
Write-Host ("Automated portable checks: {0} PASS, {1} FAIL, {2} SKIPPED" -f `
  @($results | Where-Object status -eq 'PASS').Count, $failed.Count, @($results | Where-Object status -eq 'SKIPPED').Count)
Write-Host 'PENDING (manual hardware QA): OS click-through 100/100, Pal clicks 30/30, focus, DPI matrix, fullscreen, multi-monitor, GPU/CPU budgets'
if ($failed.Count) { exit 1 }
