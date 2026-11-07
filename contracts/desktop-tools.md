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
| `snapshot` | `{window, max_nodes?: 400}` | UI Automation tree as text, one node per line, `actions=[Invoke,Toggle,Select,SetValue]` (supported subset, or `actions=[]`) and `[ref=e12]` on each node; refs live until the next snapshot of that window. A capped tree ends with `[truncated: max_nodes=N; more nodes remain]`. A read with fewer than 20 emitted nodes that is not truncated is read again after 2 s (Chromium and Electron apps build their tree on first ask) |
| `screenshot` | `{window}` | JPEG of that window through `PrintWindow(PW_RENDERFULLCONTENT)`, so a covered window still captures; no side over 1,568 px, and quality then size lowered until the base64 is at most 900,000 characters, since replies travel a pipe whose lines stop at 1 MiB |
| `click` | `{window, ref}` | `{status, focus_returned?, pointer_drift, foreground_taken_by, changes?}` |
| `type` | `{window, ref, text}` | `{status, focus_returned?, pointer_drift, foreground_taken_by, changes?}`; replaces the control's text |
| `key` | `{window, keys}` | `{status, pointer_drift, foreground_taken_by, changes?}`; keys like `Enter`, `Tab`, `Escape`; a chord with Control or Shift is refused (see Acting) |
| `scroll` | `{window, ref?, dy}` | `{status, pointer_drift, foreground_taken_by, changes?}`; `dy` positive scrolls down |
| `request_takeover` | `{reason?}` | Asks the user to take over (a login, a captcha, a choice only they can make) and waits, polling every second, until they resume the session; then the capped list of lines added and removed in the granted windows, read fresh after the resume. Returns early after 10 minutes with the request still open (call again to keep waiting) |
| `wait_for` | `{window, text, timeout_ms?: 10000}` | `{found}`; polls the tree every 250 ms for a node whose Name or value contains `text` |
| `check` | `{window, checks}` | `{passed, results: [{passed, actual}]}` (see Checks) |

`status` is `confirmed` when the helper's re-read after the action shows the value, toggle state or tree changed as
expected, else `unverifiable`. `pointer_drift` is true when the pointer position read when the op started differs from
the one read when its result is built; it is a flag only (the helper never moves the pointer), so it can be the user
moving the mouse. `foreground_taken_by` is `""` when the foreground window after the op (and after any hand-back) is
the one from before it, else the title of the window now in front (`(untitled)` when empty). `type` folds the fields
across its chunks: `pointer_drift` is true if any chunk reported true, `foreground_taken_by` is the first non-empty
value any chunk reported (else `""`).

Snapshot actions describe UI Automation patterns: `InvokePattern` gives `Invoke`, `TogglePattern` gives `Toggle`,
`SelectionItemPattern` gives `Select`, and a writable `ValuePattern` gives `SetValue`, in that order. They do not
grant permission or guarantee an enabled control. Password values remain omitted. When the snapshot window's root class is exactly `Chrome_WidgetWin_1`, a wrapper
node is skipped: any node other than the snapshot root whose role is `pane` with empty Name and empty AutomationId.
A wrapper has no line and no ref, does not count toward `max_nodes`, and its children are placed at the wrapper's own
depth in their original order. Groups, every other role and named panes are kept, and a node whose properties cannot
be read is not a wrapper. Every other window is walked unchanged. A wrapper still pending when traversal stops at
`max_nodes` counts as a node left for `truncated`. A snapshot's helper and core
result is `{text, nodes, truncated}`; `truncated` is true only when traversal has nodes left after `max_nodes`,
including when the root's children exceed the cap. Exactly reaching the cap with no nodes left is not truncated.
The MCP tool returns the text, including the truncation marker. `max_nodes` defaults to 400 and is capped at 2000
by the core.

### Changes (M8-40 row 4)

Inside the same helper op as the input, the helper walks the window's tree (at most 400 nodes, the snapshot walk,
without replacing the window's refs) right before the approved-control check and again after the action; a `click`
or `key` waits 150 ms first, since posted input lands later. A `type` walks before its first chunk and after its
last. The core compares the two by UI Automation runtime id (a node without one by its line) and returns
`changes: {added, removed, changed: [{from, to}], truncated?}`: each node as its snapshot line without indent, actions or ref,
each list at most 20 entries, `truncated: true` when one was cut. A walk that fails leaves `changes` out and never
fails the input. The walks are not returned.

### Checks (M8-40 row 3)

`checks` is 1 to 8 of `{kind: "title" | "value", ref?, op: "equals" | "contains" | "not_contains", expected}`;
`ref` (from the latest snapshot) is required for `value`; `expected` is a string of at most 2,000 characters. The
core reads the window title once and each value through the helper's `value` op, compares the full raw text, and
returns each check's `passed` and `actual` (cut to 200 characters) in order, with `passed` true only when all pass.
A password field or a control with no value reads `actual: null`, which fails every op. No model is called. A check
never creates, clears or releases an outcome hold (below).

## Errors (tool results with `isError: true`)

| Text | When |
|---|---|
| `window not granted; ask the user to give it to you` | the window is not a live grant of this session nor owned by one; also for the workbench's own windows, elevated windows, and a handle whose process or process start time differ from the grant's |
| `paused by the user` | the take-over flag is set for this session; a `type` stopped part way says how many characters landed |
| `paused: the granted window no longer shows the pinned record` | the grant is pinned and its window's title no longer matches the pattern; the session stays paused until Resume |
| `not approved: the user rejected this action`, `not approved in time`, `not sent: <reason>` | as `approvals.md` |
| `desktop not available: the MetaTrooper workbench is closed` | the workbench pipe does not answer |
| `not sent: the MetaTrooper core is offline, so this action cannot be checked` | the core pipe does not answer |
| `unknown ref <ref>; take a new snapshot` | the ref is not in the latest snapshot of that window |
| `this window has no keyboard focus (another window is in front), ...; nothing was sent` | `key` on a window whose thread reports no focused control |
| `this window is not in front, so the control holding its focus cannot be confirmed; nothing was sent` | `key` approved on a control that was read as itself, while the focused control now reads back only as its container (the window went to the background) |
| `the control holding this window's focus cannot be read, so it cannot be checked; nothing was sent` | `key` on a window whose focus HWND UI Automation cannot read; the helper reads focus once per key and never falls back to the top-level window |
| `not sent: the workbench is not running, so the agent could not be paused` | an input while the workbench that reported the take-over key has exited; the same `not sent: ..., so the agent could not be paused` names a key that never registered or was never reported (D43, F10) |
| `Control and Shift cannot be sent: ...; nothing was sent` | a `key` chord with Control, Ctrl or Shift in any position (`Alt+Shift` and a bare `Shift` too); the MCP server, `approval.check` and `desktop.act` refuse it with -32602 before any approval is asked, and the helper refuses it again |

## Acting (D78)

The helper never calls `SendInput`, `mouse_event` or `SetCursorPos`, so the pointer never moves.

- A control with its own window handle gets window messages, which keep focus: `WM_SETTEXT` for `type` (read back
  with `WM_GETTEXT`; a mismatch falls back to the pattern), `PostMessage` of `BM_CLICK` for a button or
  `WM_LBUTTONDOWN`/`WM_LBUTTONUP` at its centre for a click.
- A control without one gets its pattern: `InvokePattern`, `TogglePattern`, `SelectionItemPattern`,
  `ExpandCollapsePattern` for a click, `ValuePattern.SetValue` for `type`, `ScrollPattern` for `scroll`. When the
  foreground moved, the helper calls `SetForegroundWindow` on the window that had it and returns
  `focus_returned: true|false`. Only a pattern call gets that hand-back; every input op then reports
  `foreground_taken_by` (the window in front afterwards, `""` when unchanged) and `pointer_drift`.
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
  waits until it has), any window whose process image is this install's workbench Electron executable
  (`workbench/node_modules/electron/dist/<path.txt>`, as written and with links resolved, compared
  case-insensitively against the helper's `exe_path`; this covers the real and a demo workbench alike), elevated
  windows (`OpenProcess` refused or a raised token), and windows the helper cannot read. These are refused with
  -32003 on `grant.window`, left out of `grant.candidates`, and unreadable through every `desktop.*` call.
- One exception (M6-16): a core started with `--demo` lists, grants and reads the windows of the pid that called
  `desktop.ui-window` on it, so its own sessions can drive the demo workbench. Every other workbench window stays
  refused there too, and grants still go only to that core's own sessions.
- Ended (`ended_at` set) when the window is destroyed, its pid or process start time no longer match, its process
  ends, the user revokes it (`grant.revoke`), or the core restarts. The core checks live grants every 500 ms and at
  every call.
- `windows` lists only this session's grants.
- Pinned (M8-40e): the user can bind a grant to a title pattern (`*` matches any run of characters, the rest is
  literal, the whole title, case-sensitive) with `grant.pin`, from the workbench only. The core checks the granted
  window's own title (never an owned dialog's) on every desktop call and every 500 ms tick; a title that stops
  matching pauses that session (`meta.drift_paused`, JSON `{session_id: iso}`), and every `desktop.*` call through
  resolve and `approval.check` then refuse. Resume clears it, but a title still not matching pauses again on the
  next check. Pins (`meta.grant_pins`, JSON `{grant_id: pattern}`) end with the grant and on core restart.

## Take-over (D62)

The workbench registers `desktop.takeover_key` (default `Control+Alt+Q`) as a global shortcut. Pressing it calls
`takeover.pause`, which sets the pause time, waits for the chunk in flight to land and for 250 ms after the last posted key or click (D78), and replies `{paused_at}`: that
reply is the acknowledgement. From then on every `desktop.act` chunk and every `approval.check` for a paused
session (browser and desktop) returns "paused by the user"; queued calls are dropped the same way. The flag is
`meta.takeover_paused_at`; each session's resume is in `meta.takeover_resumed` (JSON `{session_id: iso}`). A
session is paused unless its own resume time is later than `takeover_paused_at`. The workbench checks the same
flag right before every browser input it dispatches (after the cursor glide; typing goes in pieces of 8 characters (a secret in one piece, since a piece of it would get past the scrub), and before each the pause, the page (no navigation, same origin), focus still on the approved field and, for a secret, the secret-field checks are rechecked; a change stops typing and says how much landed), and before `navigate`, `back`,
`scroll`, `dialog` and `evaluate`. `takeover.resume {session_id}`
(from the tile) clears it for that session only. Both reset on core start.

The agent can ask with `request_takeover`; the request only asks. Only the user's Accept on the tile (`takeover.pause`)
pauses. On Resume the core reads the requesting session's granted windows again (snapshot and title), compares them with
the read taken right after the pause, and hands the capped list of added and removed lines (20 each per window, 200
characters a line, 8 windows) to the waiting tool once. The text is cleaned and labelled untrusted screen data like every
tool result. Snapshot text is held in memory only, never in SQLite. A take-over started by the key with no request yields
no summary. A second pause keeps the first read. Requests reset on core start.

Input is sent only while the take-over key can pause it (D43, F10). On `desktop.ui-window {pid}` the core reads that
process's start time through the helper. Right before each helper write the core checks that the workbench reported
a registered key and that its pid is alive, and every input op carries `ui_pid` and `ui_start`: the helper refuses
the write ("the workbench is not running") unless that pid is still a running process with that start time, so a
process that reuses the pid is not taken for the workbench. A refusal reads "not sent: ..., so the agent could not
be paused". Within 500 ms of the workbench exiting (or, while a grant is live, of its pid naming another process)
every live grant ends; a workbench that starts again reports its key and pid anew.

## Helper ops

`list`, `info {hwnd}`, `snapshot {hwnd, max_nodes}`, `describe {hwnd, ref?}`, `screenshot {hwnd}`,
`set_text {hwnd, ref, value}`, `click {hwnd, ref}`, `key {hwnd, keys}`, `scroll {hwnd, ref?, dy}`,
`find_text {hwnd, text}`, `process {process}` (`{process_start}`, '' when that pid is not running), `value {hwnd, ref}`
(a control's whole value, null for a password field; the core reaches it only through `desktop.check`). `set_text`,
`click`, `key` and `scroll` also take `ui_pid` and `ui_start` (above), and `tree_before` and `tree_after` (1 to add
`[[runtime_id, line], ...]` walks to the reply, see Changes). A window from `list` or `info` carries `exe`
(the image file name) and `exe_path` (the full image path, '' when it cannot be read). One read-only op serves the
laptop test only and is never reachable through the core: `probe` (`{cursor: [x, y], foreground}`).

## Core methods

| Method | Params | Result |
|---|---|---|
| `desktop.ui-window` | `{pid, takeover_key, takeover_error}` (ui.hello) | `{}`; the workbench's process id, whose windows are never listed or granted, and the take-over key it registered (`takeover_error` null) or failed to register (`takeover_error` says why). Until a registered key is reported, `grant.window` fails with a message naming the reason, and a failure ends every live grant (decision 7, Wasif may reverse) |
| `grant.candidates` | `{}` (ui.hello) | `{windows: [{hwnd, title, exe, pid, process_start}]}`: visible top-level windows that may be granted |
| `grant.window` | `{session_id, hwnd, pid, process_start}` (ui.hello) | `{grant_id}`; -32003 for a window that cannot be granted or whose pid or process start differ from the picked candidate |
| `grant.revoke` | `{grant_id}` (ui.hello) | `{}` |
| `grant.pin` | `{grant_id, title_pattern}` (ui.hello) | `{title_pattern}`; `title_pattern` is 1 to 2000 characters, or null to unpin; -32003 when the window is gone or its title does not match the pattern now |
| `grant.live` | `{}` (ui.hello) | `{grants: [{id, session_id, hwnd, title, title_pattern, rect, minimized}]}`, `rect` = `[x, y, w, h]` in physical pixels |
| `takeover.pause` | `{}` (ui.hello) | `{paused_at}` once no chunk is in flight |
| `takeover.resume` | `{session_id}` (ui.hello) | `{}`; for a session that requested take-over, first reads its granted windows again and keeps the change summary for `takeover.status` |
| `takeover.request` | `{session_id, pid, reason?}` | `{requested, paused}`; records the request in `meta.takeover_requests` (`reason` trimmed, 200 characters, invisible and control characters removed); never pauses |
| `takeover.status` | `{session_id, pid}` | `{requested, paused, changes?}`; `changes` once, then gone |
| `desktop.windows` | `{session_id, pid}` | as the `windows` tool |
| `desktop.describe` | `{session_id, pid, window, ref?}` | `{grant_id, control, password, hidden, file_dialog, rect, token, minimized, covered_by}`; `minimized` is true when the granted window is minimised; `covered_by` is the title of another program's top-level window over the target's centre, else empty (M6-18); `token` is opaque and names the element itself (its UI Automation runtime id and process), so an `expect` carrying it matches only that element |
| `desktop.snapshot` / `desktop.screenshot` | `{session_id, pid, window, ...}` | as the tools |
| `desktop.act` | `{session_id, pid, window, action, ref?, text?, keys?, dy?, expect}` | `{status, focus_returned?, pointer_drift, foreground_taken_by, changes?}`; -32035 when the control no longer matches `expect`; -32030 "paused by the user" |
| `desktop.check` | `{session_id, pid, window, checks}` | as the `check` tool; -32602 for a malformed check list |

`pid` is the caller's own process id; the core accepts a `desktop.*` call only when the session's launcher pid is
among its ancestors.

## Workbench

- `cursor.glide {session, target_rect_px, caption}` on `\\.\pipe\metatrooper-browser` replies
  `{arrived: true, ms, shown, late}` once the session's cursor reached the target, or at `ms + 16` (`late: true`);
  `metatrooper-desktop` sends a null `target_rect_px` for a minimised window and appends " behind <title>" to the
  caption when `covered_by` is set. Shapes and timing: `agent-cursor.md`.
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
- The input watcher (M6-22) treats only a new window owned (GW_OWNER chain) by the window an action targeted,
  opened up to 1.5 s after that action, as the action's own result (the dialog it opened). Another program opening
  such a window inside those 1.5 s is not reported. Focus changes and invokes, unowned windows, other processes and
  events whose sender has no window (hwnd 0, pid 0) are reported as before.
- Apps with no UI Automation tree get screenshots only.
- `changes` covers what the tree showed 150 ms after a posted input; an app that updates later shows it in the next
  snapshot instead. The two walks add their time to every input. A `type` reports one change list for all its chunks.
- A `check` reads the state when it runs; it does not prove which action caused that state.

## Desktop outcome holds (M8-40, rows 1 and 5)

Risky desktop inputs reserve their canonical action hash in the SQLite
`desktop_action_outcome` table immediately before the first helper write.
A confirmed result permits another identical action. An unverifiable result,
helper failure after reservation, or interrupted pending action holds the hash.
Both `approval.check` and serialized `desktop.act` refuse a held hash, including
calls already approved before the first action finished. Typed text and control
names are never stored in this table. Risky results include `action_hash`.

The trusted UI can call `desktop.action.held {session_id}` to list up to 100
unresolved hashes and `desktop.action.release {session_id, action_hash}` to
release an unverifiable outcome. Pending inputs cannot be released. Release does
not approve the next input or bypass its grant and pause checks. No release tool
is exposed to the agent. Snapshots and `wait_for` do not clear holds on their own.

An input can predeclare `verify_title`, an exact expected window title that must
differ from the title read before dispatch. Only its SHA-256 is stored. The agent
can call the read-only `verify {action_hash}` tool, routed to
`desktop.action.verify {session_id, pid, action_hash}`. It rechecks the original
window and live grant, reads the title, and clears the hold only if the stored
postcondition matches. It returns `{confirmed}`; it calls no model. The
postcondition cannot be added or changed after dispatch. It is excluded from the
action hash, so changing it cannot evade a hold. The general `check` tool (row 3)
is separate and never clears a hold.

Desktop and browser MCP tool responses label screen content as untrusted data.
Text blocks remove Unicode default-ignorable code points, including tag,
zero-width and bidi controls. Each removal is logged on MCP stderr as
`{kind: "screen-text-cleaned", removed: N}`, without the screen text. The raw
control identity remains unchanged inside approval and dispatch checks.
