# M1-02: after launching claude, codex and agy for one project from the workbench, run this.
# Expect three windows titled troop-<id8> and no API key vars in this environment.
$t = Get-Process | Where-Object { $_.MainWindowTitle -match '^troop-[0-9a-f]{8}$' }
$t | Format-Table Id, ProcessName, MainWindowTitle
$keys = 'ANTHROPIC_API_KEY','OPENAI_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY' | Where-Object { [Environment]::GetEnvironmentVariable($_) }
if ($t.Count -eq 3 -and -not $keys) { Write-Host 'PASS M1-02'; exit 0 } else { Write-Host "FAIL M1-02 windows=$($t.Count) keys=$keys"; exit 1 }
