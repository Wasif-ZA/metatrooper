# M1-01: run on laptop-ops with Smart App Control ON. Expect: a workbench window from this npm run dev within 60 s, exit 0.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..\workbench')
$sac = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState
Write-Host "SAC state (1=on, 2=evaluation): $sac"
if ($sac -ne 1) { Write-Host 'NOT CHECKED M1-01: Smart App Control is not on'; exit 2 }
$p = Start-Process npm.cmd -ArgumentList 'run','dev' -PassThru -WindowStyle Hidden
function Get-Tree($root) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
  $ids = @($root); $i = 0
  while ($i -lt $ids.Count) { $ids += @($all | Where-Object ParentProcessId -eq $ids[$i] | ForEach-Object ProcessId); $i++ }
  $ids
}
$ok = $false
try {
  for ($t = 0; $t -lt 60 -and -not $ok; $t++) {
    Start-Sleep 1
    $tree = Get-Tree $p.Id
    $ok = [bool](Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $tree -contains $_.Id -and $_.MainWindowHandle -ne 0 })
  }
} finally { taskkill /T /F /PID $p.Id | Out-Null }
if ($ok) { Write-Host 'PASS M1-01: workbench window open'; exit 0 } else { Write-Host 'FAIL M1-01'; exit 1 }
