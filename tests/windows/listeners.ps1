# M4-02: node or electron listeners left on ports 3001 to 3100. Prints count=<n>, exits 1 when n > 0.
$found = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -ge 3001 -and $_.LocalPort -le 3100 } |
  ForEach-Object {
    $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -in @('node', 'electron')) { "$($_.LocalAddress):$($_.LocalPort) $($p.ProcessName) $($p.Id)" }
  } | Sort-Object -Unique)
$found | ForEach-Object { Write-Output $_ }
Write-Output "count=$($found.Count)"
if ($found.Count -gt 0) { exit 1 }
exit 0
