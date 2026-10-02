# M1-01: run on laptop-ops with Smart App Control ON. Expect: workbench window appears, exit code 0 after 15 s.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..\workbench')
$sac = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState
Write-Host "SAC state (1=on, 2=evaluation): $sac"
$p = Start-Process npm.cmd -ArgumentList 'run','dev' -PassThru -WindowStyle Hidden
Start-Sleep 15
$w = Get-Process electron -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0
if ($w) { Write-Host 'PASS M1-01: workbench window open'; Stop-Process -Id $w.Id -Force; exit 0 } else { Write-Host 'FAIL M1-01'; exit 1 }
