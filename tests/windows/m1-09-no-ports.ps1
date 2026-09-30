# M1-09: run WHILE a full two-engine-review pipeline runs. Expect no listening port owned by core/workbench/browser.
$names = 'node','electron','metatrooper-browser'
$pids = Get-Process | Where-Object { $names -contains $_.ProcessName } | ForEach-Object Id
$bad = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $pids -contains $_.OwningProcess }
$bad | Format-Table LocalAddress, LocalPort, OwningProcess
if ($bad) { Write-Host 'FAIL M1-09'; exit 1 } else { Write-Host 'PASS M1-09 (also eyeball: no WebSocket upgrade in logs)'; exit 0 }
