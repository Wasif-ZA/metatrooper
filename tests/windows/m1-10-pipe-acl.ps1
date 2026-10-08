# M1-10: run as a DIFFERENT standard local user (runas /user:<other> powershell -File this) while core runs as owner.
# Expect both pipe opens to be denied.
$fail = 0
foreach ($n in 'metatrooper','metatrooper-term','metatrooper-browser') {
  try { $c = New-Object IO.Pipes.NamedPipeClientStream('.', $n, 'InOut'); $c.Connect(2000); Write-Host "FAIL $n connected"; $fail = 1; $c.Dispose() }
  catch { Write-Host "ok $n denied: $($_.Exception.GetType().Name)" }
}
if ($fail) { exit 1 } else { Write-Host 'PASS M1-10' }
