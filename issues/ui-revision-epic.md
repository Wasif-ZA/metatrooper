# Epic: Workbench revision, agents in in-app terminals (M1 revision)

Children #33 to #38. Branch: new branch off `m2` (D20). Effort: about 18.5 Claude Code days (human team: about 3.5 months).
No deadline: Wasif would rather this takes longer and is done properly (D19).

## Context

Today agents run in separate Windows Terminal windows (spec.md D19, Rule 1 at spec.md:130). The workbench watches
from the side with 5 tabs and 2 rails (workbench/renderer/index.html:10-45, about 40 buttons). Next to Orca or
herdr it is confusing: you switch windows to type to an agent, and the app around it is mostly chrome.

The revision puts every agent in a terminal inside the app, owned by the core service so it survives the window
closing. The screen becomes one big terminal with a session list, tools already wired, and results opening
beside the terminal. This is a revision of milestone 1, not a milestone 2 item: the core service stays, how
agents run and the screen change.

## Current state (verified 2026-10-02T19:40+10:00 on branch m2)

| Area | Today | File |
|---|---|---|
| Launch | Two paths: `wt.exe -w <win> new-tab` (default) and `TROOP_LAUNCHER=spawn` (hidden, headless) | core/src/sessions/launch.ts:46-60 |
| Focus | `wt.exe focus-tab`, called from the `session.focus` method | core/src/sessions/launch.ts:63-72, core/src/methods.ts:140 |
| Prompt handoff | When an engine cannot take the prompt as an argument, a `handoff` gate copies it to the clipboard: "paste into window troop-xxxx" | core/src/pipelines/runner.ts:608-613 |
| Session host | `host CHECK ('wt','herdr')`, `window_name`, `herdr_pane` columns | contracts/schema.sql:49-51 |
| herdr leftovers | `state_source` enum value, `herdr.*` events, redact case, `herdr_at`, runner note on `continue` | core/src/engines/registry.ts:14, core/src/events/append.ts:10, core/src/events/state.ts:35, core/src/redact.ts:83, core/src/methods.ts:403, core/src/pipelines/runner.ts:572 |
| Tests | 11 test files and 1 script set `TROOP_LAUNCHER: 'spawn'`; none opens a real wt window | core/test (7 files), workbench/test (4 files), workbench/scripts/longtask-session.ts |
| Pipe protocol | NDJSON JSON-RPC, 1 MiB lines, "There are no server-pushed messages" | contracts/pipe-protocol.md:26-55 |
| Core deps | None; plain Node 24.18 (`engines >=24.16`) | core/package.json |
| Screen | Sessions, Runs, Browser, Pipelines, Hand-back tabs; Projects and Engines left rail; Gates and Needs-you right rail | workbench/renderer/index.html:10-45 |
| Pipeline editor | Table of pipelines, form per step (kind, role, prompt, uses, outputs), raw JSON toggle, validate on save | workbench/renderer/app.js:392-452 |
| Spec text | 33 mentions of wt or herdr; 4 contracts docs | spec.md, contracts/events-and-hooks.md, pipe-protocol.md, pipelines.md, testing.md |

## Decisions (locked in the /spec interview)

| # | Decision |
|---|---|
| D1 | Terminals live in the app, owned by the core service. The window only shows them. Close and reopen reattaches. Replaces spec.md D19 and Rule 1. |
| D2/D3 | Own layout: big terminal plus side session list; tile grid to watch many; Ctrl+K palette; bottom status strip (step N of M, needs-you count, usage). Arrangement settled by 3 rounds of scratch renders before code. |
| D4 | Zero setup per agent: browser MCP, toolrouter, hooks and skills wired at launch. One-click actions. Plain PowerShell and bash tabs. Drag a file, screenshot or diff line onto a terminal to put it in the prompt. |
| D5 | Done when the four user checks pass (Acceptance criteria 1 to 4). Criteria 5 to 11 are the technical checks behind them; all 11 block the merge. |
| D7 | xterm.js (MIT, 21,240 stars) and node-pty (MIT, 2,040 stars), both under the 25k gate; nothing better passes. Temporary, behind one terminal module so either can be swapped. |
| D8 | One way to run agents: delete the wt launcher, drop herdr (#27). |
| D9 | When the core dies, dead sessions show one-click Resume (engine's own resume flag, same folder). |
| D10 | Browser, diff, pipeline and hand-back open split beside their terminal. |
| D11 | Windows toast (click jumps to the session), dot on the session, count in the status strip. |
| D12 | Phone push deferred to the v3 phone epic (D40). |
| D13 | Fresh install: 3-step start (folder, agent, optional task). After that: reopen the last workspace with sessions reattached. |
| D14 | "Done, unseen" (bright dot until focused; a seen-at time, no new state). Terminal bell and title change as a status signal after hooks. Notification inbox with mark-unread. Right-click Clear status. |
| D15 | Terminal header: Diff (last turn, toggle to whole branch) and Hand back. Side split tabs: Diff, Hand-back, Browser, Tests/Review, plus the D16 panes, up to 8 tabs. |
| D16 | Running pipeline: vertical step list under its session (status, item count, loop counter, spend, inline one-button gate; a failed step opens by itself). Results open as side-split tabs: 4 new panes (Item review set, Document, Row table, Findings list) plus the locked Diff, Browser and Tests/Review. Evidence: pipeline-visuals.html. |
| D17 | Pipeline editor: today's step forms, restyled as a side-split tab that looks like the running step list; row expands to its form; drag to reorder; JSON toggle and validate on save kept. |
| D18 | Clean cut in the same change: wt branch, `focusSession`, `TROOP_LAUNCHER`, herdr code, `window_name`, `herdr_pane` all go; `host` becomes `'pty'`; the clipboard handoff becomes typing into the terminal. |
| D19 | Run history pane and the 3 remaining M2-01 built-ins wait for a later milestone. |
| D20 | Branch off m2. |

## Proposed change

```
 workbench window (Electron)                       core service (Node 24)
 +--------------------------------------+          +-------------------------------+
 | xterm.js view  <--- bytes ----------- | <------- | terminal module (node-pty)    |
 |                ---- keys, resize ---> | -------> |  one pty per session          |
 | session list, panes, palette, strip   |  term    |  scrollback ring per session  |
 |   reads SQLite (database watcher)     |  pipe    |  bell / title -> state events |
 +--------------------------------------+          |  writes prompt into the pty   |
        |  JSON-RPC (existing pipe)                 +-------------------------------+
        +------------------------------------------>  runner, gates, sessions (as today)
```

### Implementation details

**Terminal module (core/src/terminal/).** The only file that imports node-pty. Interface:
`open(sessionId, argv, cwd, env) -> pid`, `write(sessionId, data)`, `resize(sessionId, cols, rows)`,
`kill(sessionId)`, `snapshot(sessionId) -> string` (scrollback), `onExit(sessionId, code)`, `onBell`, `onTitle`. Scrollback: each
session's output is also fed into a headless xterm (`@xterm/headless`, same MIT project as xterm.js) with
`scrollback: 10000`, so a line means a terminal row at the current width. `snapshot()` is
`@xterm/addon-serialize`'s `serialize()`, which keeps colours, cursor and the alternate screen that TUIs like
codex use. The oldest rows drop off when the 10,000 are full. Memory only; a core restart loses it.

**Terminal pipe (`\\.\pipe\metatrooper-term`).** A third pipe, because the main pipe forbids pushed
messages. Full contract in "Contracts" below.

**Launch.** `launchSession` calls the terminal module instead of `wt.exe`. Prompt delivery stays on the command
line: all three built-in engines take it there (registry.ts:39, 46, 54: claude and codex positional, agy
`--prompt-interactive`). Only a plugin engine with no `prompt_arg` takes the other path (launch.ts:20). For
those, the core writes the prompt into the pty when the session first reaches `idle` from its own state
source; until then the terminal header shows a "Paste prompt" button. The clipboard `handoff` gate is removed.
`session.focus` becomes "select this session in the window" (a database row the window watches), with no
process call.

**Task 0 of #33: prove node-pty.** Core has no dependencies today and this is its first native addon. Before
anything else: node-pty installs under core's Node (24.18 on this laptop), spawns `pwsh` through ConPTY,
echoes input, resizes and exits cleanly. If its prebuilt binary does not load, try a maintained prebuilt fork
(checked against the dependency gate first), then a from-source build with the VS Build Tools. Nothing else in
#33 starts until one of the three passes.

**Schema migration.** `host CHECK (host IN ('pty'))`; existing rows set to `'pty'`; drop `window_name` and
`herdr_pane`. Migration runs at core start, idempotent. "Done, unseen" (D14) needs no column: a session is unseen when its last `done` state_at is later than its last `core.seen` event (methods.ts:123 already writes that event).

**Status signals.** The terminal module emits `term.bell` and `term.title` events. `state.ts` uses them only when
the engine's own source (hooks, notify, file-activity) has been silent for 30 s, so hooks stay first (D14).
This mainly helps agy, whose `file-activity` source (registry.ts:56) often leaves it `unknown`.

**Workbench.** New layout from the 3 render rounds (D2/D3). Terminal view uses xterm.js with the fit addon.
Panes from D16 render inside the side split. Pipeline step list sits under the session row in the session list.
The 5 tabs and 2 rails are removed; Gates and Needs-you move to the status strip and the notification inbox.

**Docs.** spec.md D19, Rule 1 and the Sessions section rewritten for in-app terminals; contracts/pipe-protocol.md
gains the terminal pipe; events-and-hooks.md, pipelines.md and testing.md lose wt and herdr text. Issue #27
closed as dropped.

## Contracts

### Terminal pipe

- Same ACL as the main pipe (pipe-protocol.md "Access"). NDJSON, UTF-8, one JSON object per line.
- **One session per connection.** A tile grid of 6 opens 6 connections.
- Client to server: `{"op":"attach","session":"<id>","cols":120,"rows":40}` first, then any of
  `{"op":"input","data":"<string>"}`, `{"op":"resize","cols":N,"rows":N}`, `{"op":"detach"}`.
- Server to client: `{"op":"snapshot","seq":0,"data":"<serialize() output>"}` once, then
  `{"op":"output","seq":N,"data":"<string>"}` with `seq` rising by 1 per message, then `{"op":"exit","code":N}`
  and close.
- **No gap between snapshot and live output:** the server serializes the headless terminal and registers the
  viewer in the same synchronous block, so every pty chunk after it arrives as `output`.
- `data` is a JS string split on code-point boundaries, at most 64 KiB per message. Messages are independent;
  the client writes each to xterm.js in `seq` order. No reassembly.
- **Slow viewer:** a connection with more than 4 MiB unsent gets `{"op":"error","code":"slow-viewer"}` and is
  closed. The window reattaches and gets a fresh snapshot. The pty never waits for a viewer.
- **Errors:** an unparseable line, an unknown `op`, or input before `attach` gets
  `{"op":"error","code":"bad-op"}` and is ignored. `attach` to an unknown or exited session gets
  `{"op":"error","code":"no-session"}` and the connection closes.
- **Disconnect** is an implicit detach; the pty keeps running. Several viewers on one session all receive
  output; input from any of them goes to the pty; the latest `resize` wins.

### Prompt typed into the terminal

- Only for engines with no `prompt_arg` (launch.ts:20). The core waits for the session's first `idle` or
  `waiting_for_you` state from its own state source after `starting`.
- It then writes the prompt followed by `\r` once and appends event `core.prompt-written`. It checks for that
  event first, so it never writes twice.
- "Paste prompt" in the terminal header calls `session.paste-prompt {session_id}`, which follows the same rule.
  Whichever comes first writes; the other returns `{"written":false,"reason":"already written"}`.
- If no such state arrives within 60 s, nothing is written automatically; the button stays until used or the
  session exits.

### Bell and title

- Events: `term.bell` with payload `{}`; `term.title` with `{"title":"<first 200 chars>"}`.
- **Silent** means no event for the session from any source other than `term.*` in the last 30 s
  (`max(event.at) WHERE session_id = ? AND kind NOT LIKE 'term.%'`).
- When silent, `term.bell` sets `waiting_for_you`, and the next pty output after a bell sets `working`.
  `term.title` sets no state; the title shows on the session row.

### Selection, inbox, status

- New table `ui_selection (window_id TEXT PRIMARY KEY, session_id TEXT REFERENCES session(id), at TEXT NOT NULL)`.
  There is one window (Electron single instance), so `window_id` is `'main'`. `session.focus` upserts it and
  calls `markSeen` as today. The window watches the row and selects that session.
- The inbox is the existing `needs_you` table (schema.sql:106) plus `read_at TEXT` and two new kinds, `done` and
  `failed`, written when a session reaches `done`, or `exited` after a failure. New methods
  `needs_you.mark-read {id}` and `needs_you.mark-unread {id}`. The strip count is open rows with `read_at` NULL.
- "Done, unseen": a session's last `done` state_at is later than its last `core.seen` event.
- Clear status: `session.clear-status {session_id}` sets `idle`, appends `core.status-cleared`, and marks that
  session's open inbox rows read.
- Toast: one Electron `Notification` per new inbox row; clicking it shows the window and calls `session.focus`.

### Resume

- `EngineSpec` and the plugin manifest gain `resume_args?: string[]` with a `{native_id}` placeholder. Built-ins:
  claude `["--resume","{native_id}"]`, codex `["resume","{native_id}"]`, agy none.
- An `exited` session with `resume_args` and a `native_id` shows Resume, which starts a new session in the same
  folder with those args. Otherwise it shows "Start new here": the same engine, same folder, no prompt.

### Zero setup, actions, shells, drag

- At an engine's first launch the core applies `installEngineSettings` (hooks/install.ts:174) with no separate
  step; the first-run screen (D13) shows it as one line. Browser and plugin MCPs already attach at launch through
  `mcpAttachArgs` (plugins/mcp.ts:72). toolrouter attaches the same way when installed as a plugin.
- One-click actions are the installed plugin actions, listed in the Ctrl+K palette and run by the existing
  action runner.
- Shell tabs (PowerShell 7, plus Git Bash when `C:\Program Files\Git\bin\bash.exe` exists) use the terminal
  module but are not `session` rows: no engine, memory only, gone when the core stops.
- Drag onto a terminal builds its text with workbench/src/comments.ts (M2-06) and sends it as `input` without
  `\r`, so the user can edit before Enter.

### Result panes

- A step names its pane with the existing `view` field (pipeline.schema.json:92); the enum gains `items`,
  `document`, `table`, `findings`. The pane reads the step's declared output file:
  - `items`: `[{"id","title","preview"?,"score"?,"reason"?,"status":"pending|approved|dropped|published|failed","error"?,"url"?}]`
  - `document`: a markdown file, plus optional `sources.json` `[{"title","url"}]` and optional `score.json`
    `{"score":0-100,"threshold":N,"parts":{"<name>":N}}`
  - `table`: `{"columns":["<step>"],"rows":[{"id","cells":{"<step>":{"status":"done|running|failed","value"?,"error"?}}}]}`
  - `findings`: `[{"severity":"critical|high|medium|low","title","file"?,"line"?,"detail","fixed_by"?}]`
- Approve, Edit and Drop on `items` write back to that file through new `run.item-set {run_id, step_id, id, status}`.

### Render rounds (#34)

- Three rounds of scratch renders, five options each, on a comparison board, before any layout code. Wasif picks
  or rejects each round. The round-3 pick, written to STATE.md, is #34's layout brief; code starts after it.

## Child issues

| # | Title | Effort (CC days) | Depends on |
|---|---|---|---|
| 33 | Terminal module, terminal pipe, launch rewrite, schema migration, clean cut of wt and herdr, docs | 5 | none |
| 34 | Layout shell: 3 render rounds, then session list, big terminal, tile grid, Ctrl+K palette, status strip, side split, first screen | 4 | 33 (code only; renders start day one) |
| 35 | Status and notifications: done-unseen, bell and title signal, toast jump, notification inbox, Clear status, Resume dead sessions | 1.5 | 33, 34 |
| 36 | Zero-setup tools: MCP, toolrouter, hooks, skills at launch; one-click actions; shell tabs; drag onto terminal | 2 | 33, 34 |
| 37 | Pipeline step list and restyled editor | 2 | 34 |
| 38 | Result panes: Item review set, Document, Row table, Findings list; Diff widened to visual and text | 4 | 37 |

```
#33 terminal core --+--> #34 layout --+--> #35 status
                    |                 +--> #36 tools
                    |                 +--> #37 step list --> #38 panes
#34 render rounds (design only) can start on day one
```

Why this order: every screen reads terminals from #33, so it lands first and alone. The layout (#34) decides
where everything sits, so status, tools and the step list wait for it. Panes (#38) render inside the step
list's split, so they come last.

## Acceptance criteria

All 11 block the merge. 1 to 4 are the user checks from D5.

1. **A workday in the app.** On one calendar day, `session` rows with `host = 'pty'` cover at least 6 hours of
   wall time (union of each row's `started_at` to its last `state_at`), and `~/.claude/history.jsonl` has no
   prompt that day whose `sessionId` is missing from `session.native_id`. One query added to core/src/gate.ts,
   which already reads both sources.
2. **First agent in 30 s.** Setup: a new local Windows account with Node 24 and the claude CLI installed and
   logged in (not timed), then the metatrooper installer. From the first window appearing to the first
   character of agent output is under 30 s, screen-recorded, no docs open.
3. **Survives the window.** Close the window while a fake engine prints a line every 100 ms; reopen after 10 s.
   The session is still `working`, and the reattached terminal's last 200 rows match the headless terminal's.
4. **Fewer clicks.** A click is one mouse click or one key chord, counted from the app focused on its home
   screen to the result visible. For start agent, approve gate, see diff, hand back and open browser, today's
   counts are written into #34 before any #34 code; no new count is higher than today's and at least 3 of the 5
   are lower (reworded 2026-10-02: start agent and approve gate were already 1 click).
5. `grep -rn "wt.exe\|TROOP_LAUNCHER\|herdr" core/src workbench/src workbench/renderer` returns nothing.
6. Killing the core marks every live session `exited`. A claude or codex session with a `native_id` shows
   Resume, which launches with its `resume_args`; agy shows "Start new here".
7. A fake engine with no `prompt_arg` gets the prompt once after its first `idle`; `core.prompt-written` appears
   once; a later Paste prompt returns `already written`; no `handoff` gate row exists.
8. A `spec-to-pr` run shows its step list with live status, gates as inline rows, and a failing step expanded
   without a click.
9. Each of the 4 new panes renders its fixture file from "Result panes", and Approve on an `items` card changes
   that item's `status` in the file.
10. **Speed**, on this laptop: attaching to a session with 10,000 rows of scrollback renders in under 500 ms
    (median of 10, from `attach` sent to the xterm.js write callback). With 6 tiles each receiving 200 lines a
    second, keystroke echo is under 50 ms (median of 50).
11. All core and workbench tests pass on the terminal module; none spawns `wt.exe`.

## Testing plan

| Layer | What | Count |
|---|---|---|
| Unit | node-pty load and ConPTY spawn (task 0); terminal module: open, write, resize, ring buffer limits, exit; status from bell and title only when hooks are silent; migration idempotent | +10 |
| Integration | Terminal pipe attach and snapshot, two viewers on one session, detach and reattach, core kill to Resume, prompt written into pty, the 12 moved tests | +8 |
| E2E (real Electron) | Window close mid-turn and reopen; spec-to-pr with gates; drag a file onto a terminal | +3 |

Codex writes the tests for #33 (core), matching the rule for #1, #4 and #6.

## Rollback

The work lands on its own branch off m2. Until it merges, m2 is untouched. After merge, revert the merge
commit; the schema migration is forward only, so a rollback also restores `contracts/schema.sql` and the
database is rebuilt from a fresh core start (session rows are history, not state anyone needs).

## Files reference

| File | Change |
|---|---|
| core/src/terminal/ (new) | Terminal module, the only node-pty import |
| core/src/terminal/pipe.ts (new) | `\\.\pipe\metatrooper-term` server |
| core/src/engines/registry.ts, contracts/plugin-manifest.schema.json | `resume_args` |
| contracts/pipeline.schema.json:92 | `view` gains items, document, table, findings |
| core/src/gate.ts | Workday query for criterion 1 |
| core/src/sessions/launch.ts:46-72 | Launch through the terminal module; delete wt and spawn branches and `focusSession` |
| core/src/methods.ts:133-140, 403 | `session.focus` writes a selection row; drop `herdr_at` |
| core/src/pipelines/runner.ts:572, 608-613 | Drop herdr note; write the prompt into the pty instead of the handoff gate |
| core/src/events/append.ts:10, state.ts:35, redact.ts:83 | Drop herdr; add `term.bell` and `term.title` |
| core/src/engines/registry.ts:14, contracts/plugin-manifest.schema.json:54 | `state_source`: drop `herdr` |
| contracts/schema.sql:49-51, 106-113 | `host` to `'pty'`, drop `window_name` and `herdr_pane`; `ui_selection` table; `needs_you.read_at` and kinds `done`, `failed` |
| contracts/pipe-protocol.md | Terminal pipe section |
| contracts/events-and-hooks.md, pipelines.md, testing.md | Remove wt and herdr |
| spec.md | D19, Rule 1, Sessions section |
| core/test (7 files), workbench/test (4 files), workbench/scripts/longtask-session.ts | Drop `TROOP_LAUNCHER`; run on the terminal module |
| workbench/renderer/index.html, app.js | New layout, terminal view, step list, editor restyle, panes |
| core/package.json | Add node-pty, @xterm/headless, @xterm/addon-serialize |
| workbench/package.json | Add xterm.js and its fit addon |

## Out of scope

- Run history pane and the 3 remaining M2-01 built-ins (website-build, e2e-browser-qa, design-variants): later milestone (D19).
- Phone push (D12), account switcher (#29 second half), Mac and Linux builds.
- Canvas editor or flow graph (D16, D17), calendar view, agent-written pipelines.
- Swapping xterm.js for ghostty-web (possible later, behind the terminal module).
- herdr host (#27, closed).

## Related

- spec.md (epic), issues #5 (workbench), #27 (closed by this), #30 (drag onto session, reused by #36).
- Research: ~/.cache/claude-scratch/metatrooper-ui-revision-2026-10-02/pipeline-visuals.html
