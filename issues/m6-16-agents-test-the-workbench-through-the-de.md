# M6-16: Agents test the workbench through the desktop tools

Part of the MetaTrooper desk epic, Milestone 6. Priority: Medium (second on the slip list). Effort: 1.5 CC days. Depends on: M6-15 (branch `m6-15-computer-use`, unmerged on 2026-10-14), M6-18 (agent cursor, specced, not built), and M6-26 (its item 10 labels; build on it, do not redo it). Start from `main` once `m6-15-computer-use` is merged. M6-18 is needed only for the recorded run's cursor; M6-16a holds without it. Record the base `main` SHA in the report.

## Context

An agent that can drive Windows apps (M6-15) can also test MetaTrooper itself: open a tile, approve a card, read a chip, the way a user would. That needs the workbench to run as a second, harmless copy:

- its own data folder and pipes;
- demo data only and no secrets;
- an approval key that unlocks nothing real.

Its window must be grantable only to that copy's own sessions. The real workbench window stays ungrantable to everyone (rule 8). `spec.md` "Agents test MetaTrooper" says this in three lines. This file is the build spec under it.

## Current state (verified 2026-10-14 on `main` 4fb7ef9 and `m6-15-computer-use` 7b6cf43; find code by the quoted text, line numbers move)

| # | Fact | Where |
|---|---|---|
| 1 | `tests/demo/seed.mjs` imports `core/src/pipelines/store.ts`, which the M6-1 split deleted, and seeds runs and gates. It no longer runs | `tests/demo/seed.mjs` |
| 2 | Demo mode today is only `METATROOPER_DEMO=1`, which hides meters and usage. There is no `--demo` flag | `workbench/src/main.ts` `process.env.METATROOPER_DEMO ? { demo: '1' }`; `style.css` demo rule |
| 3 | Isolation already exists in two variables. `METATROOPER_HOME` moves `troop.db`, `ui.key`, `settings.json` and the Electron profile: `app.setPath('userData', path.join(homeDir(), 'workbench'))` runs before `requestSingleInstanceLock()`, so a workbench with another home gets its own lock and does not hand off to the real one. `METATROOPER_PIPE_PREFIX` names the core, browser and terminal pipes | `core/src/paths.ts` `homeDir`, `pipePrefix`; `workbench/src/main.ts` |
| 4 | On M6-15, each workbench tells its own core its pid (`desktop.ui-window {pid}`), and that core refuses that pid's windows. A second workbench is just another app to the real core, so a real session could be granted the demo window. The demo core refuses its own window, which M6-16 needs to allow | `m6-15-computer-use`: `core/src/methods.ts` `desktop.ui-window`, `grant.window`; `workbench/src/main.ts` `tellCoreOurPid` |
| 5 | A core start expires every `waiting` approval (`finish(r.id, 'expired')` in the `Approvals` constructor), and a live one expires after 120,000 ms. A seeded approval row is dead on arrival | `core/src/approvals.ts` |
| 6 | Chromium builds its accessibility tree only when an assistive client asks. M6-14 found that a first UI Automation read of an Electron app returns only its frame, and `snapshot` re-reads after 2 s when it gets fewer than 20 nodes | `spec.md` "The driver" |
| 7 | The wall has almost no accessible names: one `aria-label` or `role=` match in `app.js` and two in `index.html`. M6-26 item 10 adds labels on icon-only buttons and `role="dialog"` on the Inbox and sinks popovers | `workbench/renderer/` |
| 8 | "Open preview" shows on a tile when the session owns a `ready` `session_dev_server` row (M6-3, merged). `m6-03-ports.test.ts` already has a one-line dev server that prints `Local: http://localhost:<port>/` | `core/test/m6-03-ports.test.ts` |
| 9 | The Electron E2E tests run only with `METATROOPER_UI_REVISION_E2E=1` | `workbench/test/ui-revision.test.ts` |

## Change

1. **`--demo` start.** `npm start -- --demo` (and `electron . --demo`). The first statements of `workbench/src/main.ts`, before anything reads a path:
   - set `METATROOPER_HOME` to a new folder `<os.tmpdir()>/metatrooper-demo-<pid>`, `METATROOPER_PIPE_PREFIX` to `metatrooper-demo-<pid>`, and `METATROOPER_DEMO=1`. An inherited `METATROOPER_HOME` or prefix is overridden, never reused.
   - refuse to start, exiting 2 with "demo would use the real data folder", if the resolved home equals `~/.metatrooper` or the prefix equals `metatrooper`.
   - call `app.setAccessibilitySupportEnabled(true)`.
   - set the window title to "MetaTrooper (demo)".
   - start its own core with `--demo` (the core inherits the variables). Seed the demo home before the core opens it (Change 2).
   - delete the demo home on quit.
2. **Seed without pipelines.** Rewrite `tests/demo/seed.mjs` as an exported `seedDemo(home)` that `--demo` calls, keeping its command-line use. It makes:
   - project `shop-cart` from `tests/fixtures/pr-review-fix/base` as today;
   - one fixture engine, `demo-fixture`. `--demo` writes `<home>/engines.json` as `loadEngines()` plus this entry and sets `METATROOPER_ENGINES` to it, so the real engines stay available for Change 6. The entry's command is `node`, and its args are `tests/fixtures/demo-session.mjs` with the role as the positional prompt. Shell tabs (`shell.open`) cannot stand in: they get no `session` row, so they get no tile, no dev-server row and no ancestry match;
   - after the core is up, two sessions through `session.launch` on `demo-fixture`. Role `preview` runs the M6-3 one-line dev server, so its tile gets a real "Open preview". Role `asker` sits idle until Change 5 uses it;
   - nothing else: no settings beyond defaults, no notify sinks, no secrets, no engine credentials.

   The seed checks, as today, that every stored path starts with the demo home.
3. **Who may be granted a workbench window.** On M6-15's `grant.window` and `grant.candidates`:
   - Any window whose `exe` equals this install's workbench Electron executable is refused with -32003 and never listed. The path is resolved once at core start from the repo root and compared case-insensitively after `path.resolve`. This covers the real and the demo workbench alike.
   - One exception. A core started with `--demo` lists and grants the windows of the pid that called `desktop.ui-window` on it. As before, grants go only to that core's own sessions.
   - `desktop.ui-window` keeps its role on the real core.
   - `contracts/desktop-tools.md` gets both rules.
4. **Accessible names the agent finds by.** On top of M6-26 item 10:
   - each tile root gets `role="group"` and `aria-label="<agent label>, <state>"`;
   - the approval card gets `role="dialog"` and `aria-label="Approval: <summary>"`;
   - its buttons keep their visible text "Approve" and "Reject";
   - the "Open preview" chip is a `button` whose name is its text.

   Nothing visible changes.
5. **The scripted agent.** Role `driver` of `demo-session.mjs` runs `tests/fixtures/desktop-agent.mjs`. The E2E launches it as a third `demo-fixture` session; a plain `--demo` never does. `metatrooper-desktop` therefore finds the session by process ancestry, as it would for a real agent. It spawns `core/metatrooper-desktop.js` on stdio and calls, in order:
   1. `windows`; expects exactly one window, the demo workbench.
   2. `snapshot`, then `click` the tile named `preview, ...`.
   3. `find` "Open preview".
   4. `click` "Approve" on the card for `asker`.

   It prints one JSON line per step and exits 0 only if every step held. The test makes the approval live: once the wall is up, a fixture client calls `approval.check` for `asker` over the demo pipe on a control named "Send" (D61), which waits on the card. The test, acting as the user, grants the demo window to `driver` with `grant.window` and the demo `ui.key`.
6. **A real run, by hand.** Once, Wasif or the parent session starts `--demo`, grants the window to a real Claude tile in it, and asks it to do the same three things. The report records the transcript path and whether it succeeded. This run is evidence, not a gate.

## Acceptance criteria

- [ ] M6-16a. An agent drives a `--demo` workbench: opens a tile, approves a card, reads the "Open preview" chip; no screenshot shows a real session, and the demo core cannot see the real database. Exactly, in the E2E:
  - `desktop-agent.mjs` exits 0 with 4 step lines.
  - The `asker` approval row reads `approved`, and its `approval.check` returned `approved`.
  - The `preview` tile reached by the click is the one whose `session_dev_server` row is `ready`.
- [ ] M6-16b. Isolation. The test starts `--demo` with `METATROOPER_HOME` pointed at a sentinel home whose `troop.db` holds one session labelled with a unique marker.
  - The sentinel `troop.db` has the same SHA-256 before and after the run.
  - The marker appears in no `snapshot` text and no `windows` result of the run.
  - The demo core's pipe name starts with `metatrooper-demo-`.
  - Starting `--demo` with the prefix forced to `metatrooper` exits 2 with "demo would use the real data folder".
- [ ] M6-16c. Grants.
  - On a core without `--demo`, `grant.window` on any window of a running workbench returns -32003, the demo workbench included, and `grant.candidates` lists neither.
  - On the demo core, `grant.window` on the demo window for a demo session returns a grant id.
  - On the demo core, `grant.window` on the real workbench's window (when one runs) returns -32003.
- [ ] M6-16d. Screenshots.
  - Every `screenshot` the scripted agent takes names the demo window's handle.
  - `windows` on the `driver` session never lists a window outside its grant.
- [ ] M6-16e. With `--demo`, a `snapshot` of the wall returns at least 20 nodes on its first or second read and contains: the nodes named "Open preview" and "Approve", and one `group` per seeded session.
- [ ] M6-16f. Quitting the demo workbench removes the demo home folder. A real workbench running at the same time keeps working, with its heartbeat unbroken through the run.
- [ ] M6-16g. Each test states its card: `protects=`, `fails_when=`, `no_claim=`.
- [ ] M6-16h. The existing workbench and core suites still pass.

## Testing plan

M6-16 is not in D65; the implementing agent writes these tests.

| Layer | What | Count |
|---|---|---|
| Unit | b (the demo env guard as a pure function), c (the exe rule and the demo exception against M6-15's fake helper `core/test/fake-uia-helper.js`) | +2 |
| Renderer static | e (roles and labels present in the rendered wall) | +1 |
| E2E, Windows, `METATROOPER_UI_REVISION_E2E=1` | a, b, d, e, f in one run (`workbench/test/m6-16-self-test.e2e.test.ts`) | +1 |
| Live, by hand | Change 6 | 1 run |

## Rules for the implementing agent

1. Acceptance criteria are the `protects / fails_when / no_claim` profile of each test: never "make the tests pass".
2. Real code and real tests land in the same change.
3. Any change to an existing test, timeout or threshold is reported on its own line first, with its reason.
4. A reported command names the command and its observed result; stderr is never silenced in a cited command.
5. Your report is a claim until the parent re-runs it.
6. Never commit, push or open PRs; hand back the command. No em dashes; comments say what the code does.
7. Never start, stop or restart the real core, and never point a test at `~/.metatrooper`. The sentinel home in M6-16b is a temp folder.
8. Screenshots from the E2E stay in the test's temp folder and are deleted with it.

## Rollback

Revert the merge. `--demo` writes only to its temp home. The grant rule only refuses more windows than before, so reverting it brings back M6-15's narrower rule.

## Effort

- 0.2: `--demo` flag, env guard, accessibility, title, cleanup.
- 0.3: seed rewrite (project, three fixture sessions, live dev server, approval waiter).
- 0.25: grant rule and demo exception, with their unit test.
- 0.25: accessible names on tiles, card and chip, with the static test.
- 0.5: scripted agent and the E2E with its isolation checks.

Total: 0.2 + 0.3 + 0.25 + 0.25 + 0.5 = 1.5 CC days, as in `spec.md`.

## Files

| File | Change |
|---|---|
| `workbench/src/main.ts` | `--demo`: env, guard, accessibility, title, core `--demo`, seed call, cleanup |
| `core/src/main.ts` | `--demo` flag passed to the desktop driver |
| `core/src/desktop/driver.ts` (M6-15) | the workbench exe rule and the demo exception in `grant.window` and `grant.candidates` |
| `tests/demo/seed.mjs` | rewritten without pipelines, `seedDemo(home)` exported |
| `tests/fixtures/demo-session.mjs`, `tests/fixtures/desktop-agent.mjs` | new: the three fixture roles; the scripted agent |
| `workbench/renderer/app.js`, `terminal.js` | tile, card and chip roles and names |
| `contracts/desktop-tools.md` | which workbench windows may be granted |
| `workbench/test/m6-16-self-test.e2e.test.ts`, `core/test/m6-16-grants.test.ts`, `workbench/test/m6-16-names.test.ts` | new |

## Risks

- **An agent approving a card is what rule 9 forbids on the real desk.** The guard is that only the demo window can be granted, and only on the demo core, whose approvals gate demo fixtures. If Change 3's exe match ever misses a workbench build (a packaged `MetaTrooper.exe` later), the real window becomes grantable. M6-16c has to run against whatever binary ships, and M5-1's installer work must re-run it.
- **UI Automation names come from Chromium's tree.** Electron updates can reshape it. M6-16e catches that on the next E2E run.
- **The E2E needs a real desktop session.** It cannot run headless or in CI; it is gated like the other Electron E2E tests.

## Out of scope

- Visual checks of screenshots (the five-shot and `/agy-visual` lanes do that).
- Grants on the real core to anything MetaTrooper draws, including overlay windows (M6-18 makes those click-through and not focusable).
- A demo with a real engine signed in; the hand run in Change 6 uses Wasif's own Claude.
- Recording GIFs (`/demo-capture`, M5-11).
