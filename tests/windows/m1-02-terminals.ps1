# M1-02: run from core/ after `node cli.ts launch claude|codex|agy --project <p>` for one project.
# Expect three Windows Terminal windows titled "<engine> <project>", three sessions named troop-<id8>, and no API key vars.
param([Parameter(Mandatory)][string]$Project)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [Windows.Automation.AutomationElement]::RootElement
$titles = $root.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition) |
  Where-Object { $_.Current.ClassName -eq 'CASCADIA_HOSTING_WINDOW_CLASS' } | ForEach-Object { $_.Current.Name }
$want = 'claude', 'codex', 'agy' | ForEach-Object { "$_ $Project" }
$missing = $want | Where-Object { $titles -notcontains $_ }
$rows = node cli.ts sessions --json | ConvertFrom-Json | Where-Object { $_.project -eq $Project }
$engines = ($rows | ForEach-Object { $_.engine } | Sort-Object) -join ','
$badNames = $rows | Where-Object { $_.window -notmatch '^troop-[0-9a-z]{8}$' }
$keys = 'ANTHROPIC_API_KEY','OPENAI_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY' | Where-Object { [Environment]::GetEnvironmentVariable($_) }
if (-not $missing -and $engines -eq 'agy,claude,codex' -and -not $badNames -and -not $keys) { Write-Host 'PASS M1-02'; exit 0 }
Write-Host "FAIL M1-02 missing=$missing engines=$engines badNames=$($badNames.window) keys=$keys"; exit 1
