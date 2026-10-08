param([string]$Action)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
$in = $env:TROOP_DESKTOP_INPUT | ConvertFrom-Json
$root = [System.Windows.Automation.AutomationElement]::RootElement
$UIA = [System.Windows.Automation.AutomationElement]
$Tree = [System.Windows.Automation.TreeScope]

function Find-Window([string]$title, [string]$handle, $skip = @()) {
  Select-Window @($root.FindAll($Tree::Children, [System.Windows.Automation.Condition]::TrueCondition)) $title $handle $skip
}

function Select-Window($all, [string]$title, [string]$handle, $skip = @()) {
  if ($handle) {
    $byHandle = @($all | Where-Object { [string]$_.Current.NativeWindowHandle -eq $handle })
    if ($byHandle.Count) { return $byHandle[0] }
    throw "no window with handle $handle"
  }
  $exact = @($all | Where-Object { $_.Current.Name -eq $title -and $skip -notcontains $_.Current.NativeWindowHandle })
  if ($exact.Count) { return $exact[0] }
  $part = @($all | Where-Object { $_.Current.Name -like "*$title*" })
  if ($part.Count -eq 1) { return $part[0] }
  if ($part.Count -gt 1) { throw "more than one window matches '$title'" }
  throw "no window titled '$title'"
}

function Read-Rows([string]$file) {
  $doc = Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json
  if ($doc -isnot [array] -and $doc.PSObject.Properties.Name -contains 'rows') { return @($doc.rows) }
  return @($doc)
}

function Shot([string]$title, [string]$out, [string]$handle) {
  $w = Find-Window $title $handle
  $r = $w.Current.BoundingRectangle
  if ($r.Width -le 0) { throw "window '$title' has no size (minimised?)" }
  New-Item -ItemType Directory -Force $out | Out-Null
  $bmp = New-Object System.Drawing.Bitmap ([int]$r.Width), ([int]$r.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen([int]$r.X, [int]$r.Y, 0, 0, $bmp.Size)
  $safe = ($title -replace '[^A-Za-z0-9]+', '-').Trim('-')
  $file = Join-Path $out "$safe-$($w.Current.NativeWindowHandle).png"
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  return @{ path = $file; width = [int]$r.Width; height = [int]$r.Height }
}

Add-Type -Namespace Troop -Name Mouse -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, System.UIntPtr extra);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hwnd);
'@

function Descendants($w) {
  return @($w.FindAll($Tree::Descendants, [System.Windows.Automation.Condition]::TrueCondition))
}

function Texts($w) {
  return @(Descendants $w | Where-Object { $_.Current.ControlType -ne [System.Windows.Automation.ControlType]::Edit } | ForEach-Object { $_.Current.Name } | Where-Object { $_ })
}

function Press($w, $el) {
  $invoke = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) { $invoke.Invoke(); return 'invoke' }
  [void][Troop.Mouse]::SetForegroundWindow([System.IntPtr]$w.Current.NativeWindowHandle)
  $r = $el.Current.BoundingRectangle
  [void][Troop.Mouse]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
  [Troop.Mouse]::mouse_event(0x2, 0, 0, 0, [System.UIntPtr]::Zero)
  [Troop.Mouse]::mouse_event(0x4, 0, 0, 0, [System.UIntPtr]::Zero)
  return 'click'
}

function Submit([string]$file) {
  $done = @(); $failed = @(); $used = @()
  foreach ($row in (Read-Rows $file)) {
    if (-not $row.window) { continue }
    try {
      $w = Find-Window $row.window $row.handle $used
      $used += $w.Current.NativeWindowHandle
      $btn = @(Descendants $w | Where-Object { $_.Current.Name -match '^\s*(submit|send)\s*$' -and $_.Current.ControlType -ne [System.Windows.Automation.ControlType]::Text })
      if ($btn.Count -ne 1) { throw "found $($btn.Count) Submit buttons" }
      [void](Press $w $btn[0])
      $done += $row.window
    } catch { $failed += @{ window = $row.window; error = $_.Exception.Message } }
  }
  return @{ submitted = $done.Count; windows = $done; failed = $failed }
}

function Read-Confirmations([string]$file, [string]$out) {
  Start-Sleep -Milliseconds 800
  $list = @(); $used = @()
  foreach ($row in (Read-Rows $file)) {
    if (-not $row.window) { continue }
    try {
      $w = Find-Window $row.window $row.handle $used
      $used += $w.Current.NativeWindowHandle
      $list += @{ window = $row.window; text = (Texts $w) }
    }
    catch { $list += @{ window = $row.window; error = $_.Exception.Message } }
  }
  [IO.File]::WriteAllText($out, (ConvertTo-Json -Depth 5 -InputObject $list))
  return @{ out = $out; read = @($list | Where-Object { -not $_.error }).Count; failed = @($list | Where-Object { $_.error }).Count }
}

if ($MyInvocation.InvocationName -eq '.') { return }
try {
  $result = switch ($Action) {
    'screenshot' { Shot $in.window $in.out $in.handle }
    'submit' { Submit $in.rows }
    'read' { Read-Confirmations $in.rows $in.out }
    default { throw "unknown action $Action" }
  }
  ConvertTo-Json -Compress -Depth 5 -InputObject @{ ok = $true; outputs = $result }
} catch {
  ConvertTo-Json -Compress -InputObject @{ ok = $false; error = @{ message = $_.Exception.Message; retryable = $false } }
}
