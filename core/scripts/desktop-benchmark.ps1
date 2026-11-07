param(
  [string]$Output,
  [int]$Trials = 3,
  [switch]$Fixture,
  [int]$Size = 8,
  [string]$State
)
$ErrorActionPreference = 'Stop'
if ($Fixture) {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing, System.Web.Extensions
  Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Web.Extensions -TypeDefinition @'
using System;
using System.IO;
using System.Drawing;
using System.Windows.Forms;
using System.Web.Script.Serialization;
public class BenchForm : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  public static void Run(int size, string state) {
    var f = new BenchForm { Text = "M8-38 fixture", Width = 600, Height = 500, ShowInTaskbar = false };
    var panel = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoScroll = true };
    var edit = new TextBox { Name = "fixtureInput", AccessibleName = "Fixture input", Text = "initial" };
    int clicks = 0;
    var button = new Button { Name = "fixtureSubmit", Text = "Fixture submit" };
    button.Click += (s, e) => { clicks++; };
    panel.Controls.Add(edit); panel.Controls.Add(button);
    panel.Controls.Add(new CheckBox { Text = "Fixture toggle" });
    var list = new ListBox { Name = "fixtureSelect" }; list.Items.Add("Fixture choice"); panel.Controls.Add(list);
    for (int i = 0; i < size; i++) panel.Controls.Add(new Button { Text = "Item " + i });
    f.Controls.Add(panel);
    var timer = new Timer { Interval = 25 };
    timer.Tick += (s, e) => {
      var data = new { hwnd = f.Handle.ToInt64(), text = edit.Text, clicks = clicks, size = size };
      string tmp = state + ".tmp";
      File.WriteAllText(tmp, new JavaScriptSerializer().Serialize(data));
      if (File.Exists(state)) File.Delete(state);
      File.Move(tmp, state);
    };
    timer.Start(); Application.Run(f); timer.Dispose();
  }
}
'@
  [BenchForm]::Run($Size, $State)
  exit
}
if (-not $Output) { throw 'Output JSON path is required' }
$helper = Join-Path $PSScriptRoot '../src/desktop/uia-helper.ps1'
$source = [IO.File]::ReadAllText($helper)
Invoke-Expression $source.Substring(0, $source.LastIndexOf('while ($null -ne ($line = [Console]::In.ReadLine()))'))
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class BenchSentinel {
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct GUI { public int size, flags; public IntPtr active, focus, capture, menu, move, caret; public RECT rect; }
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUI info);
  static Thread worker; static volatile bool running;
  public static int Samples, PointerChanges, FocusChanges, ReadFailures;
  static string LastPointer, LastFocus;
  static void Sample() {
    POINT p; var g = new GUI { size = Marshal.SizeOf(typeof(GUI)) };
    if (!GetCursorPos(out p) || !GetGUIThreadInfo(0, ref g)) { ReadFailures++; return; }
    string pointer = p.X + "," + p.Y, focus = GetForegroundWindow() + ":" + g.focus;
    if (LastPointer != null && LastPointer != pointer) PointerChanges++;
    if (LastFocus != null && LastFocus != focus) FocusChanges++;
    LastPointer = pointer; LastFocus = focus; Samples++;
  }
  public static void Start() {
    Samples = PointerChanges = FocusChanges = ReadFailures = 0; LastPointer = LastFocus = null;
    running = true; Sample(); worker = new Thread(() => { while (running) { Sample(); Thread.Sleep(5); } }); worker.IsBackground = true; worker.Start();
  }
  public static void Stop() { running = false; worker.Join(); Sample(); }
}
'@
function Request($request) {
  $reply = [TroopUia.Helper]::Handle(($request | ConvertTo-Json -Compress)) | ConvertFrom-Json
  if ($reply.error) { throw $reply.error }
  return $reply.result
}
function Read-State($path) {
  for ($retry = 0; $retry -lt 100; $retry++) {
    try { return Get-Content -Raw -LiteralPath $path | ConvertFrom-Json } catch { Start-Sleep -Milliseconds 25 }
  }
  throw 'Fixture state unavailable'
}
$results = @()
foreach ($count in @(8, 64, 256)) {
  for ($trial = 1; $trial -le $Trials; $trial++) {
    $statePath = Join-Path (Split-Path -Parent $Output) ('fixture-' + [guid]::NewGuid() + '.json')
    $target = $null
    $row = [ordered]@{ size = $count; trial = $trial; success = $false; snapshot_ms = $null; error = $null }
    try {
      $args = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Fixture -Size ' + $count + ' -State "' + $statePath + '"'
      $target = Start-Process powershell.exe -ArgumentList $args -WindowStyle Hidden -PassThru
      $deadline = [DateTime]::UtcNow.AddSeconds(20)
      while (-not (Test-Path -LiteralPath $statePath)) {
        if ($target.HasExited -or [DateTime]::UtcNow -gt $deadline) { throw 'Fixture did not start' }
        Start-Sleep -Milliseconds 50
      }
      $initial = Read-State $statePath
      $window = $initial.hwnd
      $ui = Request @{ op = 'process'; process = $PID }
      [BenchSentinel]::Start()
      $clock = [Diagnostics.Stopwatch]::StartNew()
      $snapshot = Request @{ op = 'snapshot'; hwnd = $window; max_nodes = 2000 }
      $clock.Stop(); $row.snapshot_ms = $clock.Elapsed.TotalMilliseconds
      $row.nodes = $snapshot.nodes
      $row.snapshot = $snapshot.text
      $inputRef = [regex]::Match($snapshot.text, '(?m)^.*#fixtureInput.*\[ref=(e\d+)\]').Groups[1].Value
      $buttonRef = [regex]::Match($snapshot.text, '(?m)^.*Fixture submit.*\[ref=(e\d+)\]').Groups[1].Value
      if (-not $inputRef -or -not $buttonRef) { throw 'Fixture controls absent from snapshot' }
      $row.type = Request @{ op = 'set_text'; hwnd = $window; ref = $inputRef; value = 'trial-' + $trial; ui_pid = $PID; ui_start = $ui.process_start }
      $row.click = Request @{ op = 'click'; hwnd = $window; ref = $buttonRef; ui_pid = $PID; ui_start = $ui.process_start }
      Start-Sleep -Milliseconds 300
      $actual = Read-State $statePath
      $row.fixture_state = $actual
      $row.success = $actual.text -eq ('trial-' + $trial) -and $actual.clicks -eq 1
      $capped = Request @{ op = 'snapshot'; hwnd = $window; max_nodes = 1 }
      $row.capped = $capped
      $row.exact_cap = Request @{ op = 'snapshot'; hwnd = $window; max_nodes = $snapshot.nodes }
    } catch { $row.error = $_.Exception.Message } finally {
      if ([BenchSentinel]::Samples -gt 0) {
        [BenchSentinel]::Stop()
        $row.samples = [BenchSentinel]::Samples
        $row.pointer_changes = [BenchSentinel]::PointerChanges
        $row.focus_changes = [BenchSentinel]::FocusChanges
        $row.sentinel_read_failures = [BenchSentinel]::ReadFailures
      }
      if ($target -and -not $target.HasExited) { Stop-Process -Id $target.Id }
      Remove-Item -LiteralPath $statePath -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath ($statePath + '.tmp') -ErrorAction SilentlyContinue
    }
    $results += [pscustomobject]$row
    $results | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $Output -Encoding UTF8
  }
}
$results | Select-Object size, trial, snapshot_ms, success, pointer_changes, focus_changes, error | Format-Table
