# Builds the Windows zip from one git ref, writes its SHA-256, and smoke-starts it in an isolated home.
# Local only: no workflow, no upload. Uploading the zip and .sha256 to GitHub Releases is a hand step.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tests/release-zip.ps1 [-Ref <commit|branch>] [-OutDir <dir>]
#        powershell -NoProfile -ExecutionPolicy Bypass -File tests/release-zip.ps1 -Zip <existing.zip>   (smoke only)
param(
    [string]$Ref = 'HEAD',
    [string]$OutDir = '',
    [string]$Zip = '',
    [int]$SmokeSeconds = 90
)

# Native tools write progress to stderr, which PowerShell 5.1 would turn into errors under 'Stop'; exit codes are checked instead.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $root 'dist/release' }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path

function Step([string]$text) { Write-Output "== $text" }

if (-not $Zip) {
    $commit = "$(git -C $root rev-parse --verify "$Ref^{commit}" 2>$null)".Trim()
    if ($LASTEXITCODE -ne 0 -or -not $commit) { throw "Unknown ref: $Ref" }
    $short = $commit.Substring(0, 8)
    $tree = Join-Path ([IO.Path]::GetTempPath()) "cc-release-$short"
    if (Test-Path $tree) { & cmd /c "git -C `"$root`" worktree remove --force `"$tree`" >nul 2>&1"; if (Test-Path $tree) { Remove-Item -Recurse -Force $tree } }
    Step "worktree $tree at $commit"
    & cmd /c "git -C `"$root`" worktree add --detach `"$tree`" $commit >nul 2>&1"
    if ($LASTEXITCODE -ne 0) { throw 'git worktree add failed' }
    try {
        foreach ($dir in 'core', 'workbench') {
            Step "npm ci in $dir"
            Push-Location (Join-Path $tree $dir)
            & cmd /c 'npm ci --no-audit --no-fund >npm-ci.log 2>&1'
            $code = $LASTEXITCODE
            Pop-Location
            if ($code -ne 0) { throw "npm ci failed in $dir (exit $code)" }
        }
        Step 'package-win.ps1'
        & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $tree 'workbench/scripts/package-win.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'package-win.ps1 failed' }
        $built = Get-ChildItem (Join-Path $tree 'dist') -Filter 'cc-*-win-x64.zip' | Select-Object -First 1
        if (-not $built) { throw 'package-win.ps1 made no zip' }
        $Zip = Join-Path $OutDir ($built.BaseName + "-$short.zip")
        Copy-Item $built.FullName $Zip -Force -ErrorAction Stop
    } finally {
        Step 'removing the build worktree'
        & cmd /c "git -C `"$root`" worktree remove --force `"$tree`" >nul 2>&1"
        if (Test-Path $tree) { Remove-Item -Recurse -Force $tree -ErrorAction SilentlyContinue }
    }
}

$Zip = (Resolve-Path $Zip).Path
$hash = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
$sumFile = Join-Path $OutDir ((Split-Path -Leaf $Zip) + '.sha256')
[IO.File]::WriteAllText($sumFile, "$hash  $(Split-Path -Leaf $Zip)`n", (New-Object Text.UTF8Encoding($false)))
Step "sha256 $hash"

# Smoke: unzip into a temp folder, start cc.exe against an isolated home and pipe, and wait for its core to answer ping.
$smoke = Join-Path ([IO.Path]::GetTempPath()) ("cc-smoke-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $smoke | Out-Null
$home2 = Join-Path $smoke 'home'
New-Item -ItemType Directory -Force $home2 | Out-Null
Expand-Archive -LiteralPath $Zip -DestinationPath $smoke -ErrorAction Stop
$app = Get-ChildItem $smoke -Directory | Where-Object Name -like 'cc-*-win-x64' | Select-Object -First 1
if (-not $app) { throw 'zip has no cc-*-win-x64 folder' }
$exe = Join-Path $app.FullName 'cc.exe'
$node = Join-Path $app.FullName 'resources/node/node.exe'
$cli = Join-Path $app.FullName 'resources/app/core/cli.ts'
foreach ($f in $exe, $node, $cli) { if (-not (Test-Path $f)) { throw "missing in zip: $f" } }

$engines = Join-Path $home2 'engines.json'
[IO.File]::WriteAllText($engines, '[]')
$vars = @{
    METATROOPER_HOME = $home2
    METATROOPER_PIPE_PREFIX = 'cc-smoke-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
    METATROOPER_ENGINES = $engines
    METATROOPER_CLAUDE_SETTINGS = (Join-Path $home2 'claude-settings.json')
    METATROOPER_CODEX_CONFIG = (Join-Path $home2 'codex-config.toml')
    METATROOPER_NEW_FOLDER_ROOT = (Join-Path $home2 'Documents-cc')
}
$saved = @{}
foreach ($k in $vars.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $vars[$k]) }

$ok = $false; $proc = $null
try {
    Step "smoke: $exe"
    $proc = Start-Process -FilePath $exe -PassThru
    # CC_SCREEN2 may name a script that takes -ProcessId and moves the window off the main screen.
    if ($env:CC_SCREEN2 -and (Test-Path $env:CC_SCREEN2)) { & powershell -NoProfile -ExecutionPolicy Bypass -File $env:CC_SCREEN2 -ProcessId $proc.Id | Out-Null }
    $deadline = (Get-Date).AddSeconds($SmokeSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($proc.HasExited) { throw "cc.exe exited early with code $($proc.ExitCode)" }
        & cmd /c "`"$node`" `"$cli`" ping >nul 2>&1"
        if ($LASTEXITCODE -eq 0) { $ok = $true; break }
        Start-Sleep -Seconds 2
    }
    if ($ok) { Start-Sleep -Seconds 3; if ($proc.HasExited) { $ok = $false; Write-Output 'cc.exe exited after the core came up' } }
} finally {
    # troop stop needs a person at the keyboard, so stop the core by the pid it records in its own database.
    $db = Join-Path $home2 'troop.db'
    if (Test-Path $db) {
        $read = "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});const r=d.prepare(`"SELECT value FROM meta WHERE key='core_pid'`").get();console.log(r?r.value:'')"
        $corePid = (& $node -e $read $db 2>$null | Select-Object -First 1)
        if ($corePid -match '^\d+$') { & cmd /c "taskkill /PID $corePid /T /F >nul 2>&1" }
    }
    if ($proc -and -not $proc.HasExited) { & cmd /c "taskkill /PID $($proc.Id) /T /F >nul 2>&1" }
    foreach ($k in $vars.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
    Start-Sleep -Seconds 2
    Remove-Item -Recurse -Force $smoke -ErrorAction SilentlyContinue
}

Write-Output ''
Write-Output "zip:    $Zip"
Write-Output "sha256: $sumFile"
if ($ok) { Write-Output 'smoke:  PASS (cc.exe started and its core answered ping)'; exit 0 }
Write-Output "smoke:  FAIL (no ping within $SmokeSeconds s)"; exit 1
