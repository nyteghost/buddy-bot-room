# CI-only Windows portable validation; runs only on an ephemeral GitHub-hosted runner.
# Evidence: non-admin smoke, adjacent Data, untouched extracted files outside Data,
# services and machine-wide uninstall keys. It cannot prove no external file writes.
param([Parameter(Mandatory=$true)][string]$ArtifactDir)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$account = "ppqa$PID"
$userCreated = $false
$proc = $null
$work = Join-Path $env:RUNNER_TEMP "pp-portable-$PID"

function Fail([string]$reason) { throw "PORTABLE VALIDATION FAILED: $reason" }
function Manifest([string]$folder) {
  $items = @{}
  Get-ChildItem -LiteralPath $folder -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($folder.Length).TrimStart('\','/').Replace('\','/')
    if (-not $rel.StartsWith('Data/')) {
      $items[$rel] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
  }
  return $items
}

try {
  $zips = @(Get-ChildItem -LiteralPath $ArtifactDir -Recurse -Filter 'PixelPals-Portable.zip' -File)
  if ($zips.Count -ne 1) { Fail "expected one portable ZIP, got $($zips.Count)" }
  $zip = $zips[0].FullName
  $shaFile = Join-Path $zips[0].DirectoryName 'PixelPals-Portable.zip.sha256'
  if (-not (Test-Path -LiteralPath $shaFile)) { Fail 'missing ZIP checksum' }
  $expected = (Get-Content -LiteralPath $shaFile -Raw).Trim().Split(' ')[0].ToUpperInvariant()
  $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($expected -ne $actual) { Fail 'ZIP SHA-256 mismatch' }
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  Expand-Archive -LiteralPath $zip -DestinationPath $work -Force
  $exes = @(Get-ChildItem -LiteralPath $work -Recurse -Filter PixelPals.exe -File)
  if ($exes.Count -ne 1) { Fail "expected one PixelPals.exe; got $($exes.Count)" }
  $appDir = $exes[0].DirectoryName
  if (-not (Test-Path -LiteralPath (Join-Path $appDir 'BUILD-INFO.txt'))) {
    Fail 'missing build provenance'
  }
  $before = Manifest $appDir
  $servicesBefore = @(Get-Service | Select-Object -ExpandProperty Name)
  $uninstallKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
  $uninstallBefore = @(Get-ChildItem -LiteralPath $uninstallKey | Select-Object -ExpandProperty PSChildName)

  $password = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)) + 'aA!'
  $secure = ConvertTo-SecureString -String $password -AsPlainText -Force
  New-LocalUser -Name $account -Password $secure -AccountNeverExpires -Description 'Ephemeral Pixel Pals CI QA account' | Out-Null
  $userCreated = $true
  Add-LocalGroupMember -Group Users -Member $account
  $admins = @(Get-LocalGroupMember -Group Administrators | Select-Object -ExpandProperty Name)
  if ($admins | Where-Object { $_ -match "(^|\\)$([regex]::Escape($account))$" }) {
    Fail 'test account unexpectedly has Administrators membership'
  }

  & icacls.exe $work /grant "$($account):(OI)(CI)M" /T | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'sandbox ACL grant failed' }

  $credential = [pscredential]::new("$env:COMPUTERNAME\$account", $secure)
  $proc = Start-Process -FilePath $exes[0].FullName -ArgumentList '--smoke-test-ms=4000' -WorkingDirectory $appDir -Credential $credential -PassThru
  try {
    Wait-Process -InputObject $proc -Timeout 20 -ErrorAction Stop
  } catch {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    Fail 'non-admin launch did not complete within timeout'
  }
  $proc.Refresh()
  if ($proc.ExitCode -ne 0) { Fail "non-admin smoke exit code $($proc.ExitCode)" }
  foreach ($name in @('s4-last-run.log','s4-smoke.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $appDir "Data\$name"))) {
      Fail "Data/$name was not created"
    }
  }

  $after = Manifest $appDir
  if (@(Compare-Object @($before.Keys | Sort-Object) @($after.Keys | Sort-Object)).Count -gt 0) {
    Fail 'extracted application file set changed outside Data/'
  }
  foreach ($key in $before.Keys) {
    if ($before[$key] -ne $after[$key]) { Fail "application file changed outside Data/: $key" }
  }
  $servicesAfter = @(Get-Service | Select-Object -ExpandProperty Name)
  $uninstallAfter = @(Get-ChildItem -LiteralPath $uninstallKey | Select-Object -ExpandProperty PSChildName)
  if (@(Compare-Object $servicesBefore $servicesAfter).Count -gt 0) { Fail 'services changed' }
  if (@(Compare-Object $uninstallBefore $uninstallAfter).Count -gt 0) { Fail 'machine-wide uninstall keys changed' }

  Write-Host 'PASS: ZIP SHA, provenance, non-admin smoke, adjacent Data, extracted files unchanged, services and uninstall keys unchanged'
  "PASS: Windows hosted-runner non-admin portable smoke; ZIP SHA256 $actual" >> $env:GITHUB_STEP_SUMMARY
  'LIMIT: no exhaustive filesystem/registry write tracing; no physical GPU acceptance.' >> $env:GITHUB_STEP_SUMMARY
} finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
  if ($userCreated) { Remove-LocalUser -Name $account -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $work) {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}
