# metatrooper-desktop MCP tools

Version 1 (M6-15, D56, D62, D71, D78). A stdio MCP server, `core/metatrooper-desktop.js` (built from
`core/src/hook/desktop-mcp.ts`), attached to every Windows session while the built-in `desktop` plugin is enabled,
except `contained` and `isolated` sessions. Disabling the plugin detaches it. Code: `core/src/grants.ts`,
`core/src/desktop/driver.ts`, `core/src/desktop/uia-helper.ps1`.

## Who does what

- **The core** owns the driver: one long-lived `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass
  -File core/src/desktop/uia-helper.ps1` per core, started on the first desktop call and spoken to over its stdin
  and stdout, one JSON request and one JSON reply per line. Every desktop read and input goes through the core's
  `desktop.*` methods, so the grant check, the pause flag and the in-flight list live in one place.
  `METATROOPER_UIA_HELPER` names another script for tests (a `.js` file runs under node, anything else under
  PowerShell).
- **The MCP server** finds its session by process ancestry, as `metatrooper-browser` does, and for every input:
  (1) `desktop.describe` on the core pipe; (2) `approval.check` (grant, D61, D62); (3) `cursor.glide` on the
  workbench pipe, waiting for the reply; (4) `desktop.act` on the core pipe with the described control as `expect`.
  The core re-describes the control right before dispatch and checks the pause flag again.
- **Recorded change from spec.md:** spec.md says the helper talks to the MCP server over a named pipe. The core
  holds it instead, so the pause flag is checked per chunk in the process that owns the flag, and a pause is
  acknowledged only after the chunk in flight has landed.

With the workbench closed, every tool fails with "desktop not available: the MetaTrooper workbench is closed".

## Tools

`window` is a window handle as a decimal number, as `windows` returns it.

| Tool | Params | Result |
|---|---|---|
| `windows` | `{}` | `{windows: [{window, title, exe, grant_id, owner}]}`: each granted window, then each open window it owns (`owner` = the handle it hangs from, 0 for the granted window) |
| `snapshot` | `{window, max_nodes?: 400}` | UI Automation tree as text, one node per line, `[ref=e12]` on each node; refs live until the next snapshot of that window. A read with fewer than 20 nodes is read again after 2 s (Chromium and Electron apps build their tree on first ask) |
| `screenshot` | `{window}` | JPEG of that window through `PrintWindow(PW_RENDERFULLCONTENT)`, so a covered window still captures; no side over 1,568 px, and quality then size lowered until the base64 is at most 900,000 characters, since replies travel a pipe whose lines stop at 1 MiB |
| `click` | `{window, ref}` | `{status, focus_returned?}` |
| `type` | `{window, ref, text}` | `{status, focus_returned?}`; replaces the control's text |
| `key` | `{window, keys}` | `{status}`; keys like `Enter`, `Tab`, `Escape`; a chord with Control or Shift is refused (see Acting) |
| `scroll` | `{window, ref?, dy}` | `{status}`; `dy` positive scrolls down |
| `wait_for` | `{window, text, timeout_ms?: 10000}` | `{found}`; polls the tree every 250 ms for a node whose Name or value contains `text` |

`status` is `confirmed` when the helper's re-read after the action shows the value, toggle state or tree changed as
expected, else `unverifiable`.

## Errors (tool results with `isError: true`)

| Text | When |
|---|---|
| `window not granted; ask the user to give it to you` | the window is not a live grant of this session nor owned by one; also for the workbench's own windows, elevated windows, and a handle whose process or process start time differ from the grant's |
| `paused by the user` | the take-over flag is set for this session; a `type` stopped part way says how many characters landed |
| `not approved: the user rejected this action`, `not approved in time`, `not sent: <reason>` | as `approvals.md` |
| `desktop not available: the MetaTrooper workbench is closed` | the workbench pipe does not answer |
| `not sent: the MetaTrooper core is offline, so this action cannot be checked` | the core pipe does not answer |
| `unknown ref <ref>; take a new snapshot` | the ref is not in the latest snapshot of that window |
| `this window has no keyboard focus (another window is in front), ...; nothing was sent` | `key` on a window whose thread reports no focused control |
| `this window is not in front, so the control holding its focus cannot be confirmed; nothing was sent` | `key` checked against a control (with a `ref`) that, with the window in the background, only reads back as its container |
| `not sent: the workbench is not running, so the agent could not be paused` | an input while the workbench that reported the take-over key has exited; the same `not sent: ..., so the agent could not be paused` names a key that never registered or was never reported (D43, F10) |
| `Control and Shift cannot be sent: ...; nothing was sent` | a `key` chord with Control or Shift; the MCP server, `approval.check` and `desktop.act` refuse it with -32602 before any approval is asked, and the helper refuses it again |

## Acting (D78)

The helper never calls `SendInput`, `mouse_event` or `SetCursorPos`, so the pointer never moves.

- A control with its own window handle gets window messages, which keep focus: `WM_SETTEXT` for `type` (read back
  with `WM_GETTEXT`; a mismatch falls back to the pattern), `PostMessage` of `BM_CLICK` for a button or
  `WM_LBUTTONDOWN`/`WM_LBUTTONUP` at its centre for a click.
- A control without one gets its pattern: `InvokePattern`, `TogglePattern`, `SelectionItemPattern`,
  `ExpandCollapsePattern` for a click, `ValuePattern.SetValue` for `type`, `ScrollPattern` for `scroll`. When the
  foreground moved, the helper calls `SetForegroundWindow` on the window that had it and returns
  `focus_returned: true|false`.
- `key` posts `WM_KEYDOWN`/`WM_KEYUP` (and `WM_CHAR` for a printable key) to the window's focused control
  (`GetGUIThreadInfo`). A window whose thread reports no focused control, as a background window often does, is
  refused ("this window has no keyboard focus"), since there is no checked control to post to. A chord with
  Control or Shift is refused: apps read those from the keyboard state, which a posted key does not change, so
  `Control+Shift+S` would arrive as a bare `s` (measured on Windows 11 Notepad, foreground and background).
- `type` is sent in chunks of at most 8 characters: chunk n sets the control's text to the first 8n characters.
  The core checks the pause flag before each chunk and waits for each chunk's reply before the next.

## Grants

A grant row (`schema.sql`, `grant`) binds a session to one top-level window. It covers that window and every window
whose `GetWindow(hwnd, GW_OWNER)` chain reaches it with the same pid and process start time (menus, popups, its
own dialogs). A window handle is first taken to its root (`GetAncestor(GA_ROOT)`), so a child control's handle
counts as its top-level window. A standard file dialog (`#32770` holding a file list, or a `#32770` whose title is
Save As, Open or Save) is covered, but every input in it carries `file_dialog: true`, so it asks every time (D61).

- Made only from the workbench: `grant.window {session_id, hwnd, pid, process_start}` over a `ui.hello` connection,
  with the pid and process start of the `grant.candidates` entry the user picked; a window that no longer matches
  them (its handle reused by another process since the list was shown) is refused.
- Never granted: the workbench's own windows (the pid the workbench reports with `desktop.ui-window`; a grant
  waits until it has), elevated windows (`OpenProcess` refused or a raised token), and windows the helper cannot
  read.
- Ended (`ended_at` set) when the window is destroyed, its pid or process start time no longer match, its process
  ends, the user revokes it (`grant.revoke`), or the core restarts. The core checks live grants every 500 ms and at
  every call.
- `windows` lists only this session's grants.

## Take-over (D62)

The workbench registers `desktop.takeover_key` (default `Control+Alt+Q`) as a global shortcut. Pressing it calls
`takeover.pause`, which sets the pause time, waits for the chunk in flight to land and for 250 ms after the last posted key or click (D78), and replies `{paused_at}`: that
reply is the acknowledgement. From then on every `desktop.act` chunk and every `approval.check` for a paused
session (browser and desktop) returns "paused by the user"; queued calls are dropped the same way. The flag is
`meta.takeover_paused_at`; each session's resume is in `meta.takeover_resumed` (JSON `{session_id: iso}`). A
session is paused unless its own resume time is later than `takeover_paused_at`. The workbench checks the same
flag right before every browser input it dispatches (after the cursor glide; typing goes in pieces of 8 characters, each checked), and before `navigate`, `back`,
`scroll`, `dialog` and `evaluate`. `takeover.resume {session_id}`
(from the tile) clears it for that session only. Both reset on core start.

Input is sent only while the take-over key can pause it (D43, F10): right before each helper write the core checks
that the workbench reported a registered key and that the workbench process it named (`desktop.ui-window {pid}`) is
still running. Otherwise the input is refused with "not sent: ..., so the agent could not be paused", and within
500 ms of the workbench exiting every live grant ends; a workbench that starts again reports its key and pid anew.

## Helper ops

`list`, `info {hwnd}`, `snapshot {hwnd, max_nodes}`, `describe {hwnd, ref?}`, `screenshot {hwnd}`,
`set_text {hwnd, ref, value}`, `click {hwnd, ref}`, `key {hwnd, keys}`, `scroll {hwnd, ref?, dy}`,
`find_text {hwnd, text}`. Two read-only ops serve the laptop test only and are never reachable through the core:
`value {hwnd, ref}` (a control's whole value, null for a password field) and `probe` (`{cursor: [x, y],
foreground}`).

## Core methods

| Method | Params | Result |
|---|---|---|
| `desktop.ui-window` | `{pid, takeover_key, takeover_error}` (ui.hello) | `{}`; the workbench's process id, whose windows are never listed or granted, and the take-over key it registered (`takeover_error` null) or failed to register (`takeover_error` says why). Until a registered key is reported, `grant.window` fails with a message naming the reason, and a failure ends every live grant (decision 7, Wasif may reverse) |
| `grant.candidates` | `{}` (ui.hello) | `{windows: [{hwnd, title, exe, pid, process_start}]}`: visible top-level windows that may be granted |
| `grant.window` | `{session_id, hwnd, pid, process_start}` (ui.hello) | `{grant_id}`; -32003 for a window that cannot be granted or whose pid or process start differ from the picked candidate |
| `grant.revoke` | `{grant_id}` (ui.hello) | `{}` |
| `grant.live` | `{}` (ui.hello) | `{grants: [{id, session_id, hwnd, title, rect, minimized}]}`, `rect` = `[x, y, w, h]` in physical pixels |
| `takeover.pause` | `{}` (ui.hello) | `{paused_at}` once no chunk is in flight |
| `takeover.resume` | `{session_id}` (ui.hello) | `{}` |
| `desktop.windows` | `{session_id, pid}` | as the `windows` tool |
| `desktop.describe` | `{session_id, pid, window, ref?}` | `{grant_id, control, password, hidden, file_dialog, rect, token}`; `token` is opaque and names the element itself (its UI Automation runtime id and process), so an `expect` carrying it matches only that element |
| `desktop.snapshot` / `desktop.screenshot` | `{session_id, pid, window, ...}` | as the tools |
| `desktop.act` | `{session_id, pid, window, action, ref?, text?, keys?, dy?, expect}` | `{status, focus_returned?}`; -32035 when the control no longer matches `expect`; -32030 "paused by the user" |

`pid` is the caller's own process id; the core accepts a `desktop.*` call only when the session's launcher pid is
among its ancestors.

## Workbench

- `cursor.glide {session, target_rect_px, caption}` on `\\.\pipe\metatrooper-browser` replies `{arrived: true}`
  (M6-18 draws the cursor before replying).
- While a session holds a grant, a thin frame in the session's colour outlines the window (a transparent,
  click-through, non-focusable window per grant, moved with the grant's rect) and the tile shows
  "driving: <title>", which revokes on click. A paused session's tile shows "paused by you" with Resume.
- Watch layout (Ctrl+Alt+W): each granted window as a live thumbnail (`desktopCapturer`, source `window:<hwnd>:0`,
  2 frames a second) beside its agent's tile.

## Known limits

- A process that calls `desktop.act` on the core pipe directly, with an `expect` that matches the control and
  without `approval.check`, is not stopped; the grant and the pause flag still apply (Threat model: a hostile
  same-user process is out of scope, as in `approvals.md`).

- A pattern action on a WinUI or UWP control moves keyboard focus to that window for a moment (D78); Windows may
  refuse the hand-back (`focus_returned: false`).
- A key or click is posted (D78). The take-over acknowledgement waits 250 ms after the last one, which narrows the gap but is not a guarantee: a target that has not read its queue by then gets the input after the acknowledgement (Wasif, 2026-10-14).
- Browser input already sent to the page when the user presses the take-over key may finish after the acknowledgement: the core does not wait on the workbench. Browser typing goes in `Input.insertText` pieces of 8 characters with the pause checked before each (D39 C), so at most one piece lands after it.
- A window closed and a new one opened at the same handle by the same process within 500 ms is not told apart.
- F9 (D43, recorded): an app that detaches an owned dialog from the granted window while a request is in flight,
  keeping its handle and process, still gets that request; the owner chain is checked in the request before the
  action, not in the helper op that acts.
- F11 (D43, recorded): an approval card that is approved after the session was paused or its grant revoked returns
  `approved` to the waiting `approval.check`; the input is still refused at dispatch, by the pause or grant check.
- The workbench is known to be running by its pid (`process.kill(pid, 0)`), so a new process that reuses that pid
  after the workbench exits keeps input allowed until the next core start.
- The input watcher (M6-22) treats a focus change, new window or invoke in the process an action targeted, up to
  1.5 s after that action, as the action's own result (the dialog it opened). A change someone else makes in that
  same process inside that window is not reported; changes in any other process still are.
- Apps with no UI Automation tree get screenshots only.
