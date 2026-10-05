# Adds a `metatrooper` command on PATH and Start menu + desktop shortcuts. Re-run after moving the repo.
$app = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $app 'build\icon.ico'
if (-not (Test-Path $electron)) { throw "electron not installed: run npm install in $app" }

$shimDir = Join-Path $env:APPDATA 'npm'
New-Item -ItemType Directory -Force $shimDir | Out-Null
Set-Content -Encoding ascii -Path (Join-Path $shimDir 'metatrooper.cmd') -Value "@echo off`r`ncall `"$app\bin\metatrooper.cmd`" %*"

$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'MetaTrooper.lnk'))
  $lnk.TargetPath = $electron
  $lnk.Arguments = "`"$app`""
  $lnk.WorkingDirectory = $app
  $lnk.IconLocation = $icon
  $lnk.Description = 'MetaTrooper'
  $lnk.Save()
}
"metatrooper command: $shimDir\metatrooper.cmd"
"shortcuts: Start menu and desktop (MetaTrooper)"
