# M6-22 input watcher: report

Branch `m6-22-input-watcher`. I merged `main` first (fast-forward to `fcf8fad`). I did not merge, push, amend, rebase
or force-push anything else, and I did not run `troop serve` or restart the core.

## Commits

| Commit | What |
|---|---|
| `6580922` | The `grant` table (migration `003-grants.sql` and the `contracts/schema.sql` block), copied byte for byte from M6-15 so the watcher can tell when a grant is live |
| `ed5fb41` | The core watcher: `core/src/watch/input-hook.ps1` (the hook helper), `core/src/watch/watcher.ts` (the matcher), wiring in `main.ts`, setting `desktop.watch_pause` (default on), meta row `input_watcher` in the schema comment, and tests. The migration-id lists in the M6-03 and M6-04 tests now include 3, the same edit M6-15 makes |
| `1941ab3` | Workbench: the snapshot gets `watcher_off` (sessions holding a live grant while `meta.input_watcher = 'off'`). Each of those tiles shows "input watcher off" in orange (`var(--wait)`, #ff7a1a) |
| `eb4501a` | Moves `desktop.watch_pause` into the spot where M6-15 adds `desktop.takeover_key` (see "Left for Wasif") |

No `core/dist` change: the build only bundles the hook entry points, and none of them import the watcher. I ran
`node core/build.ts` and it produced no diff.

## How it works

- `Watcher.tick()` runs every second in the core. While any `grant` row has `ended_at IS NULL`, it keeps
  `powershell.exe -ExecutionPolicy Bypass -File input-hook.ps1` running. When the last grant ends it stops the
  helper. `meta.input_watcher` is `on` (the helper printed `{"ready":true}`), `off` (the helper exited, errored or
  stayed silent for 15 s), or `idle` (no grant is live). A blocked helper is not retried while its grant lives.
- The helper uses `Add-Type` to compile a C# class with no native module. A thread with a
  `GetMessage`/`TranslateMessage`/`DispatchMessage` loop holds `WH_KEYBOARD_LL` and `WH_MOUSE_LL`. The callbacks only
  queue events that carry `LLKHF_INJECTED` / `LLMHF_INJECTED`, then return. A second MTA thread subscribes to UI
  Automation's FocusChanged, Window_WindowOpened and Invoke_Invoked events and records `GetLastInputInfo` idle time
  with each one. The helper prints one JSON line per event (kind, time, idle ms, root hwnd, window title) and exits
  when stdin closes.
- `judge()` does nothing with an event that falls inside a `metatrooper-desktop` action, with 200 ms of slack on each
  side (`beginAction()` / `endAction()`). Otherwise:
  - Injected key or mouse input gives `input`.
  - A UI Automation event with idle of 2 s or more gives `away`.
  - Anything else is ignored.
- `raise()` writes at most one open `needs_you` row per kind and window. The row has `kind 'other'` and
  `ref watch:<kind>:<hwnd>`. Its text is either "input from another program in "<title>"" or "the desktop changed
  while you were away from it, in "<title>"", each followed by "(the watcher cannot name the program behind it)".
  When `desktop.watch_pause` is on, it also sets `meta.takeover_paused_at`, the take-over flag M6-15 checks at
  dispatch (D62).

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| **M6-22a.** With a grant live, a PowerShell `SendKeys` run raises one "input from another program" item within 1 s and sets the pause flag. A `metatrooper-desktop` `type` in the same window raises none | **Met on this branch, with one wiring step left for the M6-15 merge** | The end-to-end test `M6-22a on this desktop` (opt-in, `METATROOPER_DESKTOP_E2E=1`) **passed on this laptop** (3.1 s). It starts the real helper with a live grant. A separate PowerShell process opens its own topmost form and checks that it holds the foreground before typing. Then `SendKeys.SendWait('abc')` produced exactly one item for that window within 1 s and set `takeover_paused_at`. A second `SendKeys` inside `beginAction()`/`endAction()` raised no item and left the flag clear. Unit tests cover the slack edges (-200, 0, +500 and +1200 ms inside; -201 and +1201 ms outside), an action that has not ended yet, and six key events giving one item. **Caveat:** on this branch the bracket is `beginAction`/`endAction`, called from the test, because M6-15's `Desktop.act` does not exist here. See "Left for Wasif" |
| **M6-22b.** With the helper blocked (fixture policy), every granted tile shows "input watcher off" | **Met** | Core test: `Watcher` with `-ExecutionPolicy Restricted` and a live grant goes to `meta.input_watcher = 'off'` (the real powershell.exe refuses the script). It stays `off` while the grant lives and returns to `idle` once the grant ends. Workbench test: `snapshot().watcher_off` lists every session with a live grant (two grants on one session list it once) and no session whose grant ended. It is empty when the watcher is `on` or when the grant table is missing. The tile template has `<span class="tile-watch" hidden>input watcher off</span>`, `label()` un-hides it from `x.watchOff`, shells never get it, and the CSS colours it `var(--wait)` (orange). Not checked: the real Electron window, since the Electron e2e suites are opt-in and I did not run them |
| **M6-22c.** With a grant live and no physical input for 5 s, a fixture that clicks a button in another app through `InvokePattern` raises one "the desktop changed while you were away from it" item within 1 s. The same script while the tester is typing raises none | **Met** | The end-to-end test `M6-22c on this desktop` (opt-in) **passed on this laptop** (9.3 s). The "other app" is a WPF window in its own PowerShell process. A WinForms button showed up to UIA as a bare Pane with no InvokePattern, so I switched to WPF. A second process calls `InvokePattern.Invoke()` on its button. (1) While that process moves the mouse 1 px and back every 100 ms (input that `GetLastInputInfo` counts, standing in for typing, which a test cannot do physically): idle was under 2 s and no away item appeared. (2) After waiting for 5 s of no input: one away item for that window within 1 s. Both clicks reached the button. Unit tests cover idle 1999 ms (none) and idle 5000 ms (one item, flag set) |

Not an acceptance criterion, and not built: spec line 538's "each window can be muted for the session from the
needs-you item". Today a window gets at most one open item per kind until someone resolves it.

## Tests run

- Core, full suite, from Git Bash: `cd core && node --test "test/*.test.ts"`. Result: **410 tests, 404 pass, 0 fail, 6
  skipped** (environment-bound or opt-in tests, including this branch's two desktop e2e tests).
- Core, this child: `node --test test/m6-22-watcher.test.ts`. Result: 9 tests, 7 pass, 2 skipped (opt-in).
- Core, desktop e2e:
  `METATROOPER_DESKTOP_E2E=1 node --test --test-name-pattern="on this desktop" test/m6-22-watcher.test.ts`. Result:
  **2 pass** (M6-22a in 3.1 s, M6-22c in 9.3 s). The final M6-22c run was by itself, after I switched the fixture to
  WPF. M6-22a passed in the run before that, which used the same 22a fixture.
- Workbench: `cd workbench && npm test`. Result: **131 tests, 92 pass, 0 fail, 35 skipped (Electron e2e, opt-in), 4
  todo**.
- Setup: `npm ci` in `core` and `workbench`. Then node-pty's `scripts/prebuild.js` and `scripts/post-install.js` by
  hand, because npm held its install scripts.

## Left for Wasif

1. **Wire the bracket when M6-15 merges.** M6-15's UIA helper never injects input (it uses PostMessage and SetValue
   only), so its actions never trip the injected-input path. But `SetValue` and `Invoke` bring the target window to
   the foreground (spike checks 4 and 5), and that fires FocusChanged and Invoked. With the user idle, the watcher
   would raise "the desktop changed while you were away" for the agent's own actions and pause it. In
   `core/src/desktop/driver.ts` `Desktop.act`, bracket the action:

   ```ts
   import { beginAction, endAction } from '../watch/watcher.ts';
   // in act():
   const watch = beginAction();
   this.actionsInFlight++;
   try { ... } finally { this.actionsInFlight--; endAction(watch); }
   ```

   This is the only spot where a `metatrooper-desktop` action reaches the helper. I left it out because that file is
   M6-15's and is not on this branch. I did not add a pipe method for it, since `desktop.act` already runs inside the
   core.
2. **One merge conflict with M6-15, on purpose.** I ran `git merge-tree HEAD m6-15-computer-use`: everything
   auto-merges except `core/src/settings.ts`. Resolve it to one block,
   `desktop: { takeover_key: 'Control+Alt+Q', watch_pause: true }`. Before my last commit that file merged with no
   conflict into two `desktop:` keys, and the second one silently dropped `takeover_key`. The `grant` migration, the
   schema block and the migration-id test edits are identical on both branches and merge without a conflict.
3. **Smart App Control.** The spike found SAC off on this laptop. "Off" is proven here only through the
   `-ExecutionPolicy Restricted` fixture, not under SAC itself. If SAC blocks the `Add-Type` compile, the helper exits
   and the tiles show "input watcher off", which is the intended fallback.
4. **Noise.** Focus and window-opened events from apps that change on their own (toasts, timers) will raise "away"
   items while a grant is live, as the spec warns. Per-window mute (spec line 538) is not built yet.
5. **Key remappers.** PowerToys Keyboard Manager, AutoHotkey and some touchpad or pen drivers turn real keystrokes
   into injected ones. While a grant is live, each of those keystrokes raises an item and pauses the agents, as D70
   says it should. It will be the first thing to bite if one is running.
6. **Slack.** UI Automation events can arrive a few hundred ms after an action ends. If, after the M6-15 wiring, the
   agent's own actions still raise "away" items, raise `SLACK_MS` in `watcher.ts` (200 ms now).
7. **Transport.** Spec line 523 says the helper reports to the core "over the pipe". It writes JSON lines to its
   stdout, which the core reads. That is the core's own child process, and no contract defines a pipe method for it.
8. **D65.** The spec lists M6-22 among the children whose tests Codex writes, followed by a mutation run. I wrote
   these tests myself, so the Codex tests and the mutation run are still to do.

## Review fixes, round 1

I ran `git merge main` first (merge commit `0627919`). Codex raised two findings, both P2, and both were real. For each
one I wrote the test, watched it fail on the old code, then fixed it in its own commit.

| Finding | Verdict | Commit | Test (fails before, passes after) |
|---|---|---|---|
| Ignore output from stopped or replaced helpers (`watcher.ts`) | **Fixed** | `d8e7e31` | `M6-22: output a stopped helper still has in its pipe changes nothing`. The test starts a helper under a live grant, ends the grant, ticks (state `idle`), then feeds `{"ready":true}` and an injected-key line into the stopped child's stdout. Before the fix: `'on' !== 'idle'`. After: the state stays `idle`, no item, no take-over flag |
| Encode helper output as UTF-8 (`input-hook.ps1`) | **Fixed** | `82c4ec1` | `M6-22: the helper writes window titles as ASCII JSON, so non-ASCII survives any console code page`. It loads the helper's C# class and runs its `Json()` on `café – 日本 😀 "q" \`. Node then parses what comes out of PowerShell's stdout. Before the fix it read `caf� - ?? ?? "q" \`. After, it reads the title intact |

- **Fix 1.** The stdout `line` handler now returns early unless `this.child === child`, the same guard the failure
  handler already used. That covers both a stopped helper and one that has been replaced.
- **Fix 2.** `Json()` now writes every character outside printable ASCII as `\uXXXX`. A surrogate pair comes out as
  two escapes, which `JSON.parse` joins back into one character. So the bytes are plain ASCII whatever the console
  code page is. I did this instead of setting `Console.OutputEncoding = UTF8`, which can put a BOM before the
  `{"ready":true}` line and break `JSON.parse` on it.
- **`core/dist`.** I ran `node core/build.ts` after each fix and it changed nothing, because the build entries never
  import `watch/*` (see "Commits" above). So neither commit includes dist.
- **Contracts.** I changed none. Neither fix changes the schema, the `meta.input_watcher` values, or any pipe method.
  The helper's stdout format is internal to the core.

Suites after the fixes, from Git Bash with Git `usr/bin` on PATH:

- Core: `cd core && node --test "test/*.test.ts"` gave **415 tests, 409 pass, 0 fail, 6 skipped**. The skips are the
  same opt-in or environment-bound tests as before.
- Workbench: `cd workbench && npm test` gave **131 tests, 92 pass, 0 fail, 35 skipped (Electron e2e, opt-in), 4
  todo**.

Left for Wasif:

- I did not rerun the opt-in desktop end-to-end tests (`METATROOPER_DESKTOP_E2E=1`) after these fixes, because they
  send real input to this desktop. Neither fix touches the path they test. Fix 1 only drops lines from a helper that
  is no longer current, and fix 2 changes only how titles are escaped. If you want to confirm, run them.
- Everything under "Left for Wasif" above still stands.

## Review fixes, round 2

`git merge main` said "Already up to date", so there is no merge commit. Codex raised one finding, a P2, and it was
real. I wrote the test, watched it fail on the old code, then fixed it in its own commit.

| Finding | Verdict | Commit | Test (fails before, passes after) |
|---|---|---|---|
| Recheck live grants before processing helper events (`watcher.ts`) | **Fixed** | `28168d8` | `M6-22: a line the current helper sends after the last grant ends, before the next tick, changes nothing and stops it`. The test starts a helper under a live grant and ends the grant without ticking. It then feeds `{"ready":true}`, an injected-key line and a UI Automation line (idle 10 s) into the current child's stdout. Before the fix: `'on' !== 'idle'`. After: the state is `idle`, there is no `input` or `away` item, no take-over flag, and the helper is stopped |

- **Fix.** The stdout `line` handler now calls `tick()` first while the child is still current. If no grant is live,
  `tick()` stops the helper and sets `idle`, and then the existing `this.child !== child` guard drops the line. So
  the check lives in one place, and the handler reuses the same grant query and stop path that the 1 s timer uses.
- **Sibling instance.** A late `{"ready":true}` line used to set `input_watcher` to `on` after the last grant ended.
  It goes through the same handler, so the same check now covers it, and the new test asserts it. `raise()` has one
  caller, this handler.
- **Second sibling, fixed in `50f4d6c`.** A helper that exited, errored or timed out after the last grant ended, but
  before the next tick, set `input_watcher` to `off` and `failed` for up to 1 s, until the tick moved it to `idle`.
  It raised no item and set no flag, but for that second the tiles said "input watcher off" with no grant live.
  `fail()` now runs the same tick-first check. Test: `M6-22: a helper that dies after the last grant ends, before the
  next tick, leaves the watcher idle, not off`. Before the fix: `'off' !== 'idle'`. After: `idle`, no child, and
  `failed` is false.
- **Choice: an event stamped before the grant ended but read after it is dropped.** I did not compare `ev.t` with
  the grant's `ended_at`. Once no grant is live, nothing is left for the item to protect, and the agents it would
  pause no longer hold the window.
- **`core/dist`.** `node core/build.ts` changed nothing, for the same reason as round 1: the build entries never import
  `watch/*`. So neither commit includes dist.
- **Contracts.** I changed none. `contracts/schema.sql` already defines `input_watcher` = `idle` as "no grant is live".
  The fix makes the code match that definition between ticks. It adds no state, column or pipe method.

Suites after the fix, from Git Bash with Git `usr/bin` on PATH:

- Core: `cd core && node --test "test/*.test.ts"` gave **417 tests, 411 pass, 0 fail, 6 skipped** after both fixes.
  That is two more tests than round 1, and the skips are the same. On the first full run, before the first commit,
  `M6-03a a dev server in the session terminal gets an ancestry row within 2 s` failed once with
  `condition not met in 2000 ms`. It passed 3 of 3 runs on its own and in the full run after the commit. It is a
  timing test from M6-03 that this branch does not touch, so I count it as a flake under load.
- Workbench: `cd workbench && npm test` gave **131 tests, 92 pass, 0 fail, 35 skipped (Electron e2e, opt-in), 4
  todo**. I ran it after `28168d8`. `50f4d6c` touches only `core/src/watch/watcher.ts` and its core test.

Left for Wasif:

- The M6-03a 2 s timing flake above, if it shows up again on main.
- The opt-in desktop end-to-end tests (`METATROOPER_DESKTOP_E2E=1`) were not rerun, because they send real input to
  this desktop. The fix only drops lines that arrive while no grant is live, and those tests always hold a grant.
- Everything under "Left for Wasif" in the earlier sections still stands.

## Review fixes, round 3

`git merge main` said "Already up to date", so there is no merge commit. Codex found nothing this round. Gemini
raised four findings. I checked each one against the code, `spec.md` and the M6-15 branch, and none of them is real,
so this round has no code commits. I did not touch `input-hook.ps1`, so I did not need to run the desktop e2e tests
or rebuild `core/dist`.

| # | Finding | Verdict | Evidence |
|---|---|---|---|
| 1 | HIGH: an action that never calls `endAction()` keeps `end: Infinity` and mutes the watcher for good | **Not real** | On this branch only the tests call `beginAction`/`endAction`. The wiring planned for M6-15 (see "Left for Wasif" item 1) calls `endAction` in a `finally`, so a rejection, a timeout or a thrown error still ends the action. Each await in M6-15's `Desktop.act` (`m6-15-computer-use:core/src/desktop/driver.ts`) settles: every `helper.request` has a 30 s timeout (`HELPER_TIMEOUT_MS`), and a stopped helper rejects all pending calls. `serial()` only waits on earlier calls, and those are bounded the same way. The suggested TTL would cause a new bug: a long `type` runs as many 8-character `set_text` chunks inside one action, so any fixed TTL could expire mid-action. Each `SetValue` brings the window forward and fires FocusChanged, so with the user idle the watcher would raise "the desktop changed while you were away" for the agent's own typing and pause it (see "Left for Wasif" item 1) |
| 2 | MEDIUM: `raise()` sets `takeover_paused_at` again when an item for that window is already open | **Not real; this is what the spec asks for** | D70 (spec line 99) says injected input with no action in flight raises the item **and**, with `desktop.watch_pause` on, sets the pause flag. Spec lines 524-526 say that for unmatched injected input the core "raises the needs-you item and sets the pause flag". The open-item check stops duplicate items, not the pause. If the user resumes while another program keeps scripting that window, pausing again is the protection D70 asks for. The open item still names the window, so the user can see why |
| 3 | MEDIUM: if a UI Automation subscription throws, `subscribed.WaitOne()` hangs until `READY_MS` (15 s) | **Not real** | An exception nobody catches on any .NET thread ends the process. I tested this in Windows PowerShell 5.1 with a probe that copies the helper's structure: `Add-Type`, a background MTA thread that throws before `subscribed.Set()`, and the main thread in `WaitOne()`. The process exited with code 1 within 1 s, not 15. That fires `exit` in `Watcher.start`, `fail()` runs, and `input_watcher` goes to `off` at once. That is the M6-22b path, already tested. The hooks thread works the same way |
| 4 | MEDIUM: injected mouse events report `GetForegroundWindow()`, not the window under the cursor | **Not real; this is what the spec asks for** | D70 (spec line 99) says the item is raised "naming the foreground window". Spec line 523 says the helper reports each injected event "with its time and the foreground window". The helper does what the spec says. A note for Wasif is below |

Sibling check: there is no other module-level state with no upper bound (`actions` is the only map, and
`endAction` prunes it). The helper has one other thread that can fail before signalling, the hooks thread. If
`SetWindowsHookEx` fails, the helper returns 2 at once. If that thread throws, the process exits, as in finding 3.

Suites, from Git Bash with Git `usr/bin` on PATH:

- Core: `cd core && node --test "test/*.test.ts"` gave **417 tests, 411 pass, 0 fail, 6 skipped**. This matches round
  2, and the skips are the same opt-in or environment-bound tests.
- Workbench: `cd workbench && npm test` gave **131 tests, 92 pass, 0 fail, 35 skipped (Electron e2e, opt-in), 4
  todo**.

Left for Wasif:

- Finding 4 is a spec choice you could revisit. For a mouse click injected into a window behind another one, the item
  names the foreground window, not the window that got the click. To name the window under the cursor, the helper
  would read the point from `MSLLHOOKSTRUCT` and call `WindowFromPoint` plus `GetAncestor(GA_ROOT)`. That would change
  D70's wording.
- Finding 1 depends on the M6-15 wiring keeping `endAction` in a `finally`. Keep it there when you merge.
- Everything under "Left for Wasif" in the earlier sections still stands.
