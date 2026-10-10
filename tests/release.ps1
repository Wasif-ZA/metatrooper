# M5-9 release gate: version check, core and workbench suites, every opt-in suite, then listeners.ps1.
# Prints one PASS, FAIL or SKIPPED line per suite; exits 1 on any FAIL, or on a SKIPPED suite not named in -AllowSkip.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tests/release.ps1 [-AllowSkip whisper,docker,network]
param([string[]]$AllowSkip = @())

$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$logs = Join-Path $root "tests/release-logs/$version"
New-Item -ItemType Directory -Force $logs | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-ddTHH-mm'
Start-Transcript -Path (Join-Path $logs "release-$stamp.log") | Out-Null

$whisper = $env:TROOP_WHISPER
if (-not $whisper) { $whisper = Join-Path "$env:LOCALAPPDATA" 'whisper.cpp\Release\whisper-cli.exe' }
$docker = $false
if (Get-Command docker -ErrorAction SilentlyContinue) { & cmd /c 'docker info >nul 2>&1'; $docker = ($LASTEXITCODE -eq 0) }

# Test files under <dir>/test that read an opt-in flag.
function FilesWith([string]$dir, [string]$flag) {
  @(Select-String -Path (Join-Path $root "$dir/test/*.test.ts") -Pattern $flag -SimpleMatch -List | ForEach-Object { "test/$($_.Filename)" })
}

$suites = @(
  @{ name = 'version'; dir = '.'; cmd = 'node tests/version-check.mjs' }
  @{ name = 'core'; dir = 'core'; cmd = 'node --test --test-reporter=spec "test/*.test.ts"' }
  @{ name = 'workbench'; dir = 'workbench'; cmd = 'node --test --test-reporter=spec --test-concurrency=1 "test/*.test.ts"' }
  @{ name = 'whisper'; dir = 'core'; cmd = 'node --test --test-reporter=spec --test-name-pattern="clips-to-scheduled-posts|footage-to-edit" test/m3-e2e.test.ts'; ready = (Test-Path $whisper); why = "whisper.cpp not found at $whisper" }
  @{ name = 'docker'; dir = 'core'; flags = @('METATROOPER_DOCKER_E2E'); ready = $docker; why = 'docker info failed' }
)
foreach ($s in @(
    @{ name = 'browser'; flags = @('METATROOPER_BROWSER_E2E') }
    @{ name = 'ui-revision'; flags = @('METATROOPER_UI_REVISION_E2E') }
    @{ name = 'desktop'; flags = @('METATROOPER_DESKTOP_E2E'); ready = [Environment]::UserInteractive; why = 'no interactive desktop session' }
    @{ name = 'network'; flags = @('METATROOPER_NETWORK_E2E', 'METATROOPER_BROWSER_E2E') })) {
  foreach ($dir in @('core', 'workbench')) {
    $t = $s.Clone(); $t.name = "$($s.name)-$dir"; $t.dir = $dir
    $suites += $t
  }
}

$results = @()
foreach ($s in $suites) {
  if (-not $s.cmd) {
    $files = FilesWith $s.dir $s.flags[0]
    if ($files.Count -eq 0) { continue }
    $s.cmd = "node --test --test-reporter=spec --test-concurrency=1 $($files -join ' ')"
  }
  Write-Output ''
  Write-Output "=== $($s.name): $($s.cmd)"
  $status = 'PASS'; $note = ''
  if ($s.ContainsKey('ready') -and -not $s.ready) {
    $status = 'SKIPPED'; $note = $s.why
  } else {
    $env:METATROOPER_FAKE_DPAPI = '1'
    foreach ($f in @($s.flags)) { if ($f) { Set-Item "env:$f" '1' } }
    Push-Location (Join-Path $root $s.dir)
    $out = @()
    & cmd /c "$($s.cmd) 2>&1" | Tee-Object -Variable out
    $code = $LASTEXITCODE
    Pop-Location
    foreach ($f in @($s.flags)) { if ($f) { Remove-Item "env:$f" -ErrorAction SilentlyContinue } }
    $pass = 0; $skipped = 0
    foreach ($l in $out) {
      if ("$l" -match '\bpass (\d+)\s*$') { $pass = [int]$Matches[1] }
      if ("$l" -match '\bskipped (\d+)\s*$') { $skipped = [int]$Matches[1] }
    }
    if ($code -ne 0) { $status = 'FAIL'; $note = "exit $code" }
    elseif ($s.flags -and $pass -eq 0 -and $skipped -gt 0) { $status = 'SKIPPED'; $note = "all $skipped tests skipped" }
    elseif ($skipped -gt 0) { $note = "$pass pass, $skipped skipped" }
    elseif ($pass -gt 0) { $note = "$pass pass" }
  }
  if ($status -eq 'SKIPPED' -and ($AllowSkip -contains $s.name -or $AllowSkip -contains ($s.name -replace '-(core|workbench)$', ''))) { $note = "$note (allowed)" }
  elseif ($status -eq 'SKIPPED') { $note = "$note (counts as FAIL; pass -AllowSkip $($s.name -replace '-(core|workbench)$', '') to allow)" }
  $results += [pscustomobject]@{ name = $s.name; status = $status; note = $note; bad = ($status -eq 'FAIL' -or ($status -eq 'SKIPPED' -and $note -notlike '*(allowed)')) }
}

Write-Output ''
Write-Output '=== listeners'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'tests/windows/listeners.ps1')
$listeners = $LASTEXITCODE
$results += [pscustomobject]@{ name = 'listeners'; status = $(if ($listeners -eq 0) { 'PASS' } else { 'FAIL' }); note = ''; bad = ($listeners -ne 0) }

Write-Output ''
foreach ($r in $results) {
  $line = "{0,-8} {1,-22} {2}" -f $r.status, $r.name, $r.note
  if ($r.status -eq 'SKIPPED') { Write-Output "!!!!! $line" } else { Write-Output "      $line" }
}
$failed = @($results | Where-Object { $_.bad }).Count
Write-Output ''
if ($failed) { Write-Output "release $version FAIL: $failed suite(s)" } else { Write-Output "release $version PASS" }
Stop-Transcript | Out-Null
if ($failed) { exit 1 }
exit 0
