# M7-1: Browser tools version 3: presets, numbered screenshots, batch, wider waits, covered tags, re-attach, WebMCP spike

Part of the MetaTrooper desk epic, Milestone 7 (after the release). Priority: High. Effort: 2.75 CC days. Depends on: M6-11 (merged, `77ab911`), M6-12 (branch `m6-12-handoff`, unmerged on 2026-10-14). Nothing here starts before the public release on 2027-01-19. Start from `main` once `m6-12-handoff` is merged; it changes every file this child touches. Record that `main` SHA as the base in the report.

## Context

The browser tools work (M6-11, M6-12). What rivals' users still ask for is fewer wasted turns and less risk:

- A session that only needs to look should not hold `evaluate`.
- A screenshot should say which box is which ref.
- Four form steps should not cost four round trips.
- A wait should cover "the spinner went away" and "the URL changed".
- A ref under a modal should say so before the click fails.
- A pane whose debugger detached should come back on its own.

Each item names its idea in the idea mine (`~/.cache/claude-scratch/metatrooper-idea-mine-2026-10-10/`, lanes browser-control and browser-pane). Code is ported only from MIT or Apache-2.0 sources (pinchtab, agent-browser, playwright, browser-use, orca). WebMCP is a spike first, because Chromium gates it behind a feature switch.

## Current state (verified 2026-10-14 on `main` 4fb7ef9 and `m6-12-handoff`; find code by the quoted text, line numbers move, and M6-12 moves them again)

| # | Fact | Where |
|---|---|---|
| 1 | The MCP server advertises 16 tools: `panes, navigate, back, snapshot, read, click, type, key, select, scroll, wait_for, screenshot, evaluate, console, network, dialog`. M6-12 adds `handoff` (17). `tools/list` returns all of them | `core/src/hook/browser-mcp.ts` `const TOOLS`, `case 'tools/list': return reply({ tools: TOOLS })` |
| 2 | The workbench browser server keeps its own tool set, which adds `describe` and has no `panes` | `workbench/src/browser/server.ts` `const TOOLS = new Set(` |
| 3 | `browser.hello` returns only `{ ok: true, bound: 'session' }` (or `'core'` with a UI key). The MCP side ignores the result unless it is an error. No grant or preset exists anywhere, and `core/src/browser/grants.ts` does not exist | `server.ts`; `browser-mcp.ts` `this.raw('browser.hello'` |
| 4 | `session.launch` takes only `browser?: boolean` for the browser. `.troop/config.json` is read only for `allow_hosts` | `core/src/methods.ts` `browser: p.browser === true`; `panes.ts` `allowHosts()` |
| 5 | Browser error codes are raw numbers: -32032 dialog open, -32033 click blocked, **-32034 page crashed or not responding**, -32035 control changed. M6-12 adds -32036, -32037 and -32038. -32034 is taken, so the grant error the old text named cannot use it. The next free code is -32039 | `panes.ts` `new ToolError(-32034, pane.crashed)`; `contracts/browser-tools.md` |
| 6 | `isolated()` calls `Page.createIsolatedWorld` on every call; it has 5 callers. Nothing listens for `Runtime.executionContextsCleared` or `executionContextDestroyed` | `panes.ts` `worldName: 'metatrooper'` |
| 7 | `wait_for` takes `text` (polls `innerText`) or `ref`, polls every 200 ms, and silently clamps to `Math.min(Number(a.timeout_ms) \|\| 10_000, 30_000)`. It returns `{found}` only | `panes.ts` `case 'wait_for'` |
| 8 | The network ring `pane.network` keeps 200 entries (`LOG_KEEP = 200`) with a start time and no finish time, so "no request for N ms" cannot be told today | `panes.ts` |
| 9 | Screenshots use `Page.captureScreenshot` and have no annotate option. Refs map `frameId:backendNodeId` and are stable across snapshots (M6-11). The click path's `box()` calls `DOM.scrollIntoViewIfNeeded` before `DOM.getBoxModel`, so reusing `box()` for a whole page would scroll it | `panes.ts` `box(`; `core/src/browser/snapshot.ts` |
| 10 | The click path's hit test in `target()` uses `elementFromPoint` and returns `'is outside the viewport'` or `'is covered by <tag>'`. No snapshot line carries such a tag | `panes.ts` `const at = (x, y) =>` |
| 11 | No `dbg.on('detach')` exists. The only debugger listener is `pane.dbg.on('message')`. After a detach every command fails with -32099 "<method> failed". `attach()` enables Fetch (`urlPattern: '*'`), Network, Runtime, Page and DOM. The parked viewport is `PARKED_VIEWPORT = { width: 1280, height: 800 }` via `applyViewport`. DevTools opens as `openDevTools({ mode: 'detach' })` | `panes.ts` |
| 12 | No `batch` tool exists. Approvals run only for `CHECKED = new Set(['click','type','select','key'])` through `checkedCall` (`browser.describe`, then `approval.check`, then the action with `expect`, retried up to 3 times on -32035) | `browser-mcp.ts` |
| 13 | Audit rows `browser.tool` `{tool, pane, origin, status}`, one per call, exist only on `m6-12-handoff` (`audit()` in `server.ts`) | `m6-12-handoff` |
| 14 | No `navigator.modelContext` use anywhere. Electron is pinned at 44.4.5 | `workbench/package.json` |

## Change

1. **Tool presets** (browser-control 4, after pinchtab, MIT).
   - New `core/src/browser/grants.ts` exports `PRESETS`, a single source for both the MCP list and the workbench check:
     - `look`: panes, navigate, snapshot, screenshot, scroll, read, handoff. That is 7 tools.
     - `act`: look plus back, click, type, key, select, wait_for, dialog, batch, page_call (page_call only if Change 7 passes).
     - `debug`: act plus console, network, evaluate. That is every tool.

     `key` was missing from the earlier text; it goes in `act` with the other D61-checked inputs.
   - The preset comes from `session.launch {browser_grant}`, else the project's `.troop/config.json` `browser.grant`, else none. None means every tool, as today. An unknown name fails the launch with -32602 "unknown browser grant <name>; one of look, act, debug".
   - It is stored in a new nullable `session.browser_grant` column (next free migration, plus `contracts/schema.sql`).
   - `browser.hello` returns `{ok, bound, grant}`, and `tools/list` lists only the grant's tools.
   - The workbench server checks every `browser.*` call against the session's stored grant, not the MCP's word. A call outside the grant fails **-32039** "needs grant <preset>", where <preset> is the smallest preset holding that tool. `E.GRANT_NEEDED = -32039` is added to `core/src/pipe/errors.ts`.
   - D61 approvals stay the only confirm step. Presets add no second one.
2. **Numbered screenshots** (browser-control 10, after agent-browser, Apache-2.0).
   - `screenshot {annotate: true}` takes each live ref from the last snapshot and reads its box with `DOM.getBoxModel` alone. It never calls `box()` or `scrollIntoViewIfNeeded`, because the page must not move (fact 9).
   - It keeps the boxes inside the captured area. In the isolated world it adds one `pointer-events: none` container with a red box and a number per ref, captures, and removes the container in a `finally`.
   - The result adds a text legend, one line per number: `n -> ref, x,y,w,h`.
   - No snapshot yet means the call fails -32602 "take a snapshot first".
3. **Batch** (browser-control 11, after agent-browser).
   - `batch {pane_id, steps: [{tool, args}], stop_on_error: true}` takes 1 to 20 steps of navigate, back, click, type, key, select, scroll or wait_for.
   - `browser-mcp.ts` runs them one at a time through the same `toolCall` path as single calls. So `checkedCall`, approvals, grant checks and M6-12's audit rows apply per step.
   - Refs come from a snapshot taken before the batch; a batch takes no snapshot.
   - A step waiting on an approval waits as a single call would. A rejected or failed step counts as a failure, and with `stop_on_error` the rest report `skipped`.
   - The result is one entry per step plus the last run step's page footer, once.
   - A batch is checked against the grant as a whole before step 1. Any step outside the grant fails the whole batch with -32039, and nothing runs.
4. **One isolated world per document, wider waits** (browser-control 15, after playwright, Apache-2.0).
   - `isolated()` caches the `executionContextId` per frame. The existing `dbg.on('message')` handler drops the cache on `Runtime.executionContextsCleared`, and on `Runtime.executionContextDestroyed` for a cached id.
   - The network ring entries gain `done_at`, set on `Network.loadingFinished` and `loadingFailed`.
   - `wait_for` gains `text_gone`, `url_includes` and `idle_ms`. `idle_ms` means no request started and none open for that long. The conditions race with the existing `text` and `ref`; at least one is required.
   - The result adds `clamped_to_ms: 30000` when a larger `timeout_ms` was cut.
5. **Covered and off-screen tags** (browser-control 19, after browser-use, MIT).
   - After the snapshot walk, one batched `Runtime.callFunctionOn` in the isolated world runs the same hit-test logic as `target()` at each ref's box centre. The boxes come from `DOM.getBoxModel` without scrolling. Make the hit test one shared function source so the two cannot drift.
   - A ref whose test says covered gets ` [covered]`, and one outside the viewport gets ` [offscreen]`. Nothing is dropped.
   - Over 400 refs, only the first 400 in document order are tested.
6. **Re-attach after a detach** (browser-pane 13, after orca, MIT).
   - `pane.dbg.on('detach', (_e, reason))` logs the reason. Unless the pane is closing, it re-runs `attach()`'s enables and Fetch interception, re-applies `pane.parked` through `applyViewport`, drops the world cache, and sets `reconnected: true` on the pane's next state event.
   - Two detaches within 5 s stop the retries and mark the pane crashed with "the page's debugger keeps detaching".
   - DevTools: build step 1 checks on this laptop whether `openDevTools({mode: 'bottom'})` keeps the pane's debugger attached and stays inside its tile. The result goes in this file. If it passes, the `'detach'` mode at the `case 'devtools'` line becomes `'bottom'`; if not, it stays.
7. **WebMCP spike, then page tools** (browser-control 12, after playwright).
   - Build step 2, a 0.25-day spike on Electron 44.4.5. It loads a fixture page that registers one tool and records whether `navigator.modelContext` exists with no command-line switch. The result goes in this file: pass or fail, the Electron version, and the switch if one was needed.
   - If it passes, `snapshot` lists page tools in its header (`- name [consequential]: description`), and `page_call {pane_id, name, args}` runs one, capped at 50 tools and 32 KB of input. Every call to a `consequential` tool goes through `approval.check` (D61) first. Results are labelled page content. An unknown name fails, listing the names.
   - If it needs `--enable-features=WebMCP` or any experimental switch, page tools stay out of M7, `page_call` is not added, and the `act` preset loses it.
8. **Contracts.** `contracts/browser-tools.md` (version 3) gets the presets, -32039, the new tools and arguments, the legend shape, the tags, and `reconnected`.

## Acceptance criteria

- [ ] M7-01a. A session launched with `look` lists exactly 7 tools. `evaluate` fails -32039 naming `debug`, both through the MCP server and as a direct `browser.evaluate` on the pipe for that session. A launch with the preset `evalute` fails -32602. A session with no preset lists every tool.
- [ ] M7-01b. A fixture with 12 buttons in view and 8 below the fold returns an annotated screenshot whose legend has exactly 12 entries. Afterwards a DOM query finds 0 overlay nodes, and `window.scrollY` is the same as before the call. With no snapshot taken, the call fails -32602.
- [ ] M7-01c. On a login fixture whose refs come from one snapshot, `type`, `type`, `click`, `wait_for {url_includes}` run in 1 `batch` call with 4 results.
  - With step 2 on a removed ref, steps 3 and 4 read `skipped`, and the pane has 2 `browser.tool` rows from the batch.
  - A step on a D61 risky button waits for its approval; if it is rejected, the steps after it read `skipped`.
  - A `look` session's batch holding `click` fails -32039 before any step runs (0 `browser.tool` rows).
- [ ] M7-01d. Wider waits:
  - A 10 s `wait_for` makes at most 1 `Page.createIsolatedWorld` call.
  - A page that removes "Loading" at 1.5 s resolves `text_gone` within 2 s.
  - `timeout_ms: 60000` returns `clamped_to_ms: 30000`.
  - A navigation then an `evaluate` makes exactly 1 new world.
  - `url_includes: "/done"` resolves within 500 ms of a fixture redirect.
  - `idle_ms: 500` resolves 500 to 700 ms after the last fixture request finishes.
- [ ] M7-01e. A fixture with 10 buttons, 4 under a modal and 3 below the fold, tags exactly 4 `[covered]` and 3 `[offscreen]`, and `window.scrollY` is unchanged. On a 400-ref page the snapshot takes at most 1.2 times as long as without tags.
- [ ] M7-01f. After a forced `dbg.detach()`:
  - Within 1 s, a `click` works.
  - A request the policy blocks is still blocked.
  - A parked pane still reports its parked viewport width.
  - The next state event carries `reconnected: true`.
  - Two forced detaches within 5 s leave the pane crashed with that message.
  - The laptop check's result is in this file. DevTools opens docked (`mode: 'bottom'`) if the check passed and detached if not.
- [ ] M7-01g. The WebMCP spike's result (pass or fail, Electron version, the switch used if any) is in this file. If it passed:
  - a fixture registering 3 tools (1 consequential) lists 3;
  - a call to the consequential one creates one `approval` row and runs only after approval;
  - `page_call` fails -32039 under `look`;
  - an unknown name lists the 3 names.
- [ ] M7-01h. Each test states its card: `protects=`, `fails_when=`, `no_claim=`.
- [ ] M7-01i. The existing core and workbench suites still pass, M6-11's and M6-12's browser tests among them.

## Testing plan

Codex writes the tests for this child (D65) through `/tests-brief`, from this file and the code. A mutation run must fail at least one test per change: drop the server-side grant check, drop the `finally` overlay removal, drop the batch pre-check, drop the world cache reset, drop the hit-test tag, and drop the detach listener.

| Layer | What | Count |
|---|---|---|
| Unit | presets and smallest-preset naming; legend building; batch step rules; `idle_ms` from a fake ring | +4 |
| Integration (Electron, fixture pages, existing browser test harness) | a, b, c, d, e, f | +6 |
| Spike and laptop checks, by hand, recorded in this file | DevTools docking; WebMCP | 2 |
| Integration, only if the spike passed | g | +1 |

## Rules for the implementing agent

1. Acceptance criteria are the `protects / fails_when / no_claim` profile of each test: never "make the tests pass".
2. You write the code; Codex writes the tests (D65). Do not write or edit tests yourself. Report a test you think is wrong on its own line.
3. Any change to an existing test, timeout or threshold is reported on its own line first, with its reason.
4. A reported command names the command and its observed result; stderr is never silenced in a cited command.
5. Your report is a claim until the parent re-runs it.
6. Never commit, push or open PRs; hand back the command. No em dashes; comments say what the code does.
7. The two checks in Changes 6 and 7 run first, and their results are written into this file before any code for those changes.

## Rollback

Revert the merge. `session.browser_grant` stays, nullable and unused, which older code ignores. Sessions with no grant behaved the same before and after.

## Effort

Idea sizes as `spec.md` uses them (S 0.25, M 0.75):

- 0.75 presets (browser-control 4), including the column, the server check and -32039;
- 0.25 numbered screenshots (10);
- 0.25 batch (11);
- 0.25 worlds and waits (15);
- 0.25 covered tags (19);
- 0.25 re-attach (browser-pane 13);
- 0.75 WebMCP spike and page tools (12).

Total: 0.75 + 0.25 + 0.25 + 0.25 + 0.25 + 0.25 + 0.75 = 2.75 CC days, as in `spec.md`. If the spike fails, 0.5 of the 0.75 for item 12 is not spent.

## Files

| File | Change |
|---|---|
| `core/src/browser/grants.ts` | new: `PRESETS`, smallest-preset lookup |
| `core/src/hook/browser-mcp.ts` | `tools/list` by grant; `batch`; `page_call`; `annotate`, wait and tag arguments in the schemas |
| `workbench/src/browser/server.ts` | hello returns the grant; per-call grant check; tool set gains `batch`, `page_call` |
| `workbench/src/browser/panes.ts` | annotate; world cache; ring `done_at`; wait conditions; tags; detach handler; DevTools mode |
| `core/src/methods.ts`, `core/src/sessions/launch.ts` | `browser_grant` on launch and from `.troop/config.json` |
| `core/src/pipe/errors.ts` | `GRANT_NEEDED: -32039` |
| `core/src/store/migrations/<next>-browser-grant.sql`, `contracts/schema.sql` | `session.browser_grant` |
| `contracts/browser-tools.md` | version 3 |
| `core/test/m7-01-*.test.ts`, `workbench/test/m7-01-*.test.ts` | new, by Codex |

## Risks

- **Merge conflicts with M6-12.** `m6-12-handoff` changes `browser-mcp.ts`, `server.ts`, `panes.ts` and the contract. Building before it merges means rebuilding.
- **WebMCP is likely gated.** Playwright starts Chromium with `--enable-features=WebMCP`. If Electron 44 needs it too, item 12 ends at the spike, by design.
- **Docked DevTools can resize the pane under the agent.** The laptop check decides, and the default stays detached.
- **A detach caused by the user's own DevTools attach.** The 5 s double-detach stop keeps the handler from fighting it.

## Out of scope

- A `confirm` list per tool (pinchtab's third mode). D61 stays the only confirm step.
- Scripting in a batch (Playwriter's `execute`). Steps are tool calls only.
- Paint-order covering from DOM snapshots (browser-use's full method). One hit test per ref centre is enough to tag.
- Device emulation while DevTools is open (M7-3).
