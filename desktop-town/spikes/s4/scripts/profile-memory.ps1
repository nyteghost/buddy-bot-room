# Read-only resource profiler for PixelPals.exe (no install, no admin, no network).
#
# Samples, once per interval, for ONE process:
#   * Private bytes (commit charge)        Get-Process PrivateMemorySize64
#   * Working set (incl. shared DLL pages) Get-Process WorkingSet64
#   * Private working set                  Win32_PerfFormattedData_PerfProc_Process.WorkingSetPrivate
#                                          (= Task Manager "Memory" column)
#   * Shared working set                   working set - private working set (driver/runtime DLL pages)
#   * GPU dedicated / shared memory        Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory
#                                          (summed over this PID's adapters)
#   * CPU % of ONE logical core            TotalProcessorTime delta / wall time
#   * GPU 3D engine utilisation %          Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine (engtype_3D)
# CIM performance classes are used instead of Get-Counter paths because counter
# path names are localised on non-English Windows. GPU classes can be missing
# (e.g. some VMs); those columns are then empty, never invented.
#
# Usage (from the extracted PixelPals-Portable folder):
#   # Launch and profile a 10-minute walking soak, CSV + summary in Data\:
#   .\QA\profile-memory.ps1 -Exe .\PixelPals.exe -Arguments '--smoke-test-ms=600000','--qa-walk' -Seconds 610 -WarmupSeconds 10
#   # Attach to an already running, interactively used PixelPals.exe for 30 min:
#   .\QA\profile-memory.ps1 -AttachName PixelPals -Seconds 1800
# If the script is blocked as "downloaded from the internet", run
#   Unblock-File .\QA\*.ps1   (only on a machine you are allowed to run scripts on).
[CmdletBinding(DefaultParameterSetName = 'Launch')]
param(
  [Parameter(ParameterSetName = 'Launch', Mandatory = $true)][string]$Exe,
  [Parameter(ParameterSetName = 'Launch')][string[]]$Arguments = @(),
  [Parameter(ParameterSetName = 'Attach', Mandatory = $true)][string]$AttachName,
  [int]$Seconds = 60,
  [int]$IntervalMs = 1000,
  # Samples taken before this many seconds stay in the CSV but are excluded
  # from the summary statistics (start-up is not steady state).
  [double]$WarmupSeconds = 0,
  [string]$CsvPath = '',
  [string]$SummaryPath = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($PSCmdlet.ParameterSetName -eq 'Launch') {
  $exePath = (Resolve-Path -LiteralPath $Exe).Path
  $proc = Start-Process -FilePath $exePath -ArgumentList $Arguments -WorkingDirectory (Split-Path $exePath) -PassThru
  $null = $proc.Handle
} else {
  $proc = @(Get-Process -Name $AttachName -ErrorAction Stop)[0]
  $null = $proc.Handle
}
$procId = $proc.Id
if (-not $CsvPath) { $CsvPath = Join-Path $env:TEMP "pixelpals-profile-$procId.csv" }

function Get-PerfRow([string]$Class, [string]$Filter) {
  try { return @(Get-CimInstance -ClassName $Class -Filter $Filter -ErrorAction Stop) } catch { return @() }
}

$rows = [System.Collections.Generic.List[object]]::new()
$watch = [System.Diagnostics.Stopwatch]::StartNew()
$lastCpu = $null; $lastWall = 0.0
while (-not $proc.HasExited -and $watch.Elapsed.TotalSeconds -lt $Seconds) {
  $proc.Refresh()
  # A process that is exiting reports zero counters: never record those.
  if ($proc.HasExited -or $proc.PrivateMemorySize64 -le 0) { break }
  $wall = $watch.Elapsed.TotalSeconds
  $cpu = $proc.TotalProcessorTime.TotalSeconds
  $cpuPct = if ($null -ne $lastCpu -and $wall -gt $lastWall) { [Math]::Round(100.0 * ($cpu - $lastCpu) / ($wall - $lastWall), 2) } else { $null }
  $lastCpu = $cpu; $lastWall = $wall
  $perf = @(Get-PerfRow 'Win32_PerfFormattedData_PerfProc_Process' "IDProcess=$procId")
  $gpuMem = @(Get-PerfRow 'Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory' "Name LIKE 'pid_$($procId)_%'")
  $gpuEng = @(Get-PerfRow 'Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine' "Name LIKE 'pid_$($procId)_%engtype_3D'")
  $rows.Add([pscustomobject]@{
      t_s                  = [Math]::Round($wall, 1)
      private_bytes_mib    = [Math]::Round($proc.PrivateMemorySize64 / 1MB, 2)
      working_set_mib      = [Math]::Round($proc.WorkingSet64 / 1MB, 2)
      private_ws_mib       = $(if ($perf.Count) { [Math]::Round([double]$perf[0].WorkingSetPrivate / 1MB, 2) } else { $null })
      # Shared resident pages: DLL images (D3D12/DXGI/DComp/GPU driver) and other shareable mappings.
      shared_ws_mib        = $(if ($perf.Count) { [Math]::Round(($proc.WorkingSet64 - [double]$perf[0].WorkingSetPrivate) / 1MB, 2) } else { $null })
      gpu_dedicated_mib    = $(if ($gpuMem.Count) { [Math]::Round(($gpuMem | Measure-Object -Property DedicatedUsage -Sum).Sum / 1MB, 2) } else { $null })
      gpu_shared_mib       = $(if ($gpuMem.Count) { [Math]::Round(($gpuMem | Measure-Object -Property SharedUsage -Sum).Sum / 1MB, 2) } else { $null })
      cpu_pct_one_core     = $cpuPct
      gpu_3d_pct           = $(if ($gpuEng.Count) { ($gpuEng | Measure-Object -Property UtilizationPercentage -Sum).Sum } else { $null })
    })
  Start-Sleep -Milliseconds $IntervalMs
}
if ($PSCmdlet.ParameterSetName -eq 'Launch' -and -not $proc.HasExited) { $null = $proc.WaitForExit(15000) }
$rows | Export-Csv -LiteralPath $CsvPath -NoTypeInformation -Encoding utf8

function Stat([string]$Column) {
  $values = @($rows | Where-Object { $_.t_s -ge $WarmupSeconds -and $null -ne $_.$Column } | ForEach-Object { [double]$_.$Column })
  if (-not $values.Count) { return $null }
  # @() everywhere: PowerShell unrolls single-element arrays.
  $sorted = @($values | Sort-Object)
  return [ordered]@{
    first = $values[0]; last = $values[-1]; min = $sorted[0]; max = $sorted[-1]
    median = $sorted[[int][Math]::Floor(($sorted.Count - 1) / 2)]
    growth_last_minus_first = [Math]::Round($values[-1] - $values[0], 2)
  }
}
$summary = [ordered]@{
  note             = 'Process-scoped samples; CPU is % of ONE logical core; GPU memory from GPU Process Memory counters. Null = counter unavailable.'
  pid              = $procId
  samples          = $rows.Count
  warmup_seconds   = $WarmupSeconds
  steady_samples   = @($rows | Where-Object { $_.t_s -ge $WarmupSeconds }).Count
  interval_ms      = $IntervalMs
  process_exited   = $proc.HasExited
  exit_code        = $(if ($proc.HasExited) { $proc.ExitCode } else { $null })
  private_bytes_mib = Stat 'private_bytes_mib'
  working_set_mib  = Stat 'working_set_mib'
  private_ws_mib   = Stat 'private_ws_mib'
  shared_ws_mib    = Stat 'shared_ws_mib'
  gpu_dedicated_mib = Stat 'gpu_dedicated_mib'
  gpu_shared_mib   = Stat 'gpu_shared_mib'
  cpu_pct_one_core = Stat 'cpu_pct_one_core'
  gpu_3d_pct       = Stat 'gpu_3d_pct'
  csv              = $CsvPath
}
$json = $summary | ConvertTo-Json -Depth 4
if ($SummaryPath) { $json | Set-Content -LiteralPath $SummaryPath -Encoding utf8 }
Write-Output $json
