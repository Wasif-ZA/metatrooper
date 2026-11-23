# M6-14 spike result: built-in UI Automation on this laptop

Run 2026-10-11T16:20+11:00 to 2026-10-11T16:53+11:00 on the laptop, Windows 11 (build 26200), Windows PowerShell
5.1.26100. Nothing was installed. The helper code is two small C# classes compiled with `Add-Type` (window
rectangles, `PrintWindow`, `GetWindow`, `PostMessage`, cursor and foreground reads, and a low-level hook probe).
Every check typed only into a new empty Notepad tab (checked empty by length first), Character Map, or Calculator;
the user's own Notepad tabs were never written. Screenshots taken for check 3 were viewed and deleted, because the
tab bar showed the user's file names.

Environment as found: `Get-MpComputerStatus` reports Smart App Control **Off** on this laptop, so these results do
not prove the helper runs under Smart App Control on. Execution policy: `Process` Bypass in the shell that ran the
checks, every other scope Undefined.

## Results

| # | Check | Result | Output |
|---|---|---|---|
| 1 | List top-level windows | Pass | `RootElement.FindAll(Children)`: 10 windows |
| 2 | Read Notepad's tree | Pass | 40 nodes (Text 11, Pane 9, Button 7, TabItem 5); the text area is `Document`, class `RichEditD2DPT`, with `ValuePattern` and `TextPattern` |
| 3 | Capture Notepad while covered | Pass | `PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT)` returned true, 1440x753, with Calculator overlapping Notepad's rectangle: the image showed Notepad's content and no Calculator pixels |
| 4 | Type into a window that does not have focus, pointer unmoved | **Fail as specified** | `ValuePattern.SetValue` set the text and never moved the pointer, but it brought the target to the foreground every time: Notepad (WinUI) went from background to foreground; Character Map's Win32 edit took the foreground from Notepad and its value did not read back at once |
| 4b | Same, with a window message | Pass for Win32 controls | `SendMessage(edit_hwnd, WM_SETTEXT, ...)` into Character Map's edit while Notepad held the foreground: value read back by `WM_GETTEXT` equal, foreground unchanged. WinUI controls have no window handle of their own, so this route does not exist for them |
| 5 | Click a Calculator button with `InvokePattern` | Pass, with focus taken | `num7Button`, `plusButton`, `num8Button`, `equalButton` invoked: display went from "Display is 0" to "Display is 15", pointer unmoved. Invoking a Calculator button while Notepad held the foreground moved the foreground to CalculatorApp; invoking Notepad's own Add New Tab button brought Notepad to the front the same way |
| 6 | Reach Notepad's Save As as an owned window | Pass | File menu `ExpandCollapsePattern.Expand`, "Save as" `Invoke`: a `#32770` dialog whose `GetWindow(dlg, GW_OWNER)` is Notepad's main window; closed with `WindowPattern.Close`, nothing saved |
| 7 | Access error on an elevated window | Not run | No elevated window was open (token elevation checked on every windowed process); opening one needs a UAC prompt, which only the user can answer |
| 8 | Compile the `Add-Type` class, and M6-22's hook class | Pass | Compiled in 113 ms. `SetWindowsHookEx(WH_KEYBOARD_LL)` and `(WH_MOUSE_LL)` both returned a handle and were removed again |

## Check 9: five apps in daily use

Picked from the windows open at the time. Counts only: no control names or text were recorded. "Interactive" is
Button, Edit, CheckBox, RadioButton, ComboBox, ListItem, MenuItem, TabItem, TreeItem, Hyperlink, Slider and
Document; "with a pattern" means Invoke, Value, Toggle, SelectionItem or ExpandCollapse.

| App | First read | After a second read | Interactive with a pattern |
|---|---|---|---|
| VS Code | 13 nodes, 3 interactive | 388 nodes, 145 interactive | 133 of 145 (92%) |
| Opera | 103 nodes, 44 interactive | same | 44 of 44, browser toolbar only; page content is not in the tree |
| Spotify | 26 nodes, 5 interactive | 737 nodes, 247 interactive | 247 of 247 |
| File Explorer (a folder window) | 163 nodes, 106 interactive | same | 106 of 106 |
| Discord | 7 nodes, 0 interactive | 7 nodes after three reads | none |

Four of the five expose usable patterns, so pattern actions do not fail on most of them. Chromium and Electron
apps (VS Code, Spotify) build their tree only after a UI Automation client first asks: the first read returns the
window frame, a read a few seconds later returns the app. Discord exposed nothing on any read.

## What this means for M6-15

- Reading the tree, capturing covered windows, owned dialogs and the hook helper all work as the spec assumes.
- Acting through UI Automation patterns moves keyboard focus to the target window, on both WinUI and Win32 apps.
  The pointer never moves, but keys the user types at that moment go to the agent's window. The spec's "your mouse
  and keyboard stay yours" holds for the mouse only.
- A Win32 control with its own window handle can be typed into with `WM_SETTEXT` without taking focus.
- `snapshot` needs a warm-up read on Chromium and Electron apps before it reports their controls.

## Commands

Each check was a short block in Windows PowerShell 5.1 after `Add-Type -AssemblyName UIAutomationClient,
UIAutomationTypes` and `Add-Type -TypeDefinition <the C# class> -ReferencedAssemblies System.Drawing`. The calls
that decided each result:

```powershell
$A::RootElement.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)  # 1
$A::FromHandle($hwnd).FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)  # 2, 9
[SpikeNative]::Capture($hwnd, $png)  # 3: PrintWindow(hwnd, hdc, 2) into a Bitmap
$doc.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue($text)  # 4
[Msg]::SendMessage($editHwnd, 0x000C, [IntPtr]::Zero, $text)  # 4b: WM_SETTEXT, read back with WM_GETTEXT (0x000D)
$button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()  # 5
[SpikeNative]::GetWindow($dialogHwnd, 4)  # 6: GW_OWNER
[Elev]::Elevated($pid)  # 7: OpenProcess + GetTokenInformation(TokenElevation)
[HookProbe]::InstallAndRemove()  # 8: SetWindowsHookEx(13 and 14) then UnhookWindowsHookEx
[SpikeNative]::GetForegroundWindow(); [SpikeNative]::GetCursorPos([ref]$p)  # before and after every action
```

The C# classes and run notes are kept in `~/.cache/claude-scratch/metatrooper-m6-14-spike-2026-10-11/`.
