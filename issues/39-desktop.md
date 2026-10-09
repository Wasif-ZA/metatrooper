# `desktop` plugin, handoff gate UI, `form-fill-batch`

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

Part of the MetaTrooper epic. Milestone 3. Effort: about 3 Claude Code days.

Depends on: child #15, child #16, child #17.

## What

`desktop` plugin, handoff gate UI, `form-fill-batch`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Foreground. The loop stops for a captcha about every 35 s, too often to stay folded. Done or cancelled, it settles
as a calm 36px wall bar.

- Layouts: coverage-map (row grid), triage (task queue), preview-stage (take control), pr-first (submit), run-log.
  Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens at run start. Folded by hand, it opens again when `captcha` or `approve` waits, or any step fails.
- Pick, first match: a failure to run-log; a shown captcha to preview-stage on that row's window; a row with no
  captcha keeps the current layout; `approve` to pr-first; otherwise coverage-map. triage is by hand only.
- Steps (approve-once decided by Wasif 2026-10-05): `map` (agent, plan), `fill` (agent, worker), `captcha` (gate,
  handoff), `shot` (action, visual-check, loop over `fill`, `captcha`, `shot` until no rows are left, max 20),
  `approve` (gate, approve, guards `submit`), `submit` (action, publish, external, one action for every row),
  `confirm` (action, verify). 6 rows means 6 captcha stops and 1 approve.

## Acceptance criteria

- [ ] M3-01. Each milestone-3 built-in runs end to end on its fixture and stops at every gate before a publish step.
- [x] M3-03. `form-fill-batch` pauses at a handoff gate when the fixture form shows its captcha stand-in and resumes on Continue.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.

## Helper tools (M4-8)

| Helper | Repo | Licence | Risk | Egress | Step it helps |
|---|---|---|---|---|---|
| Windows-MCP | CursorTouch/Windows-MCP | MIT | OK | `ANONYMIZED_TELEMETRY` defaults to `true`; set it to `false`. Show orange on the chip | map and fill |
| pywinauto | pywinauto/pywinauto | BSD-3-Clause | OK | none (local GUI automation) | fill |
| Playwright | microsoft/playwright | Apache-2.0 | OK | not checked (browser traffic goes to the sites it drives) | fill and submit |
| UFO | microsoft/UFO | MIT | OK | not checked (an LLM agent; screenshots may reach the model it is set to use) | map |

Helpers are optional. Each pipeline runs without them. They are listed in `pipelines/assists/registry.json` once the pipeline is built (registry format in `issues/m4-09-helper-tools.md`).

## Ideas (M4-8)

### Requirements

- Replay row 1 for rows 2 to N: the agent fills row 1 and saves the action list; code replays it for later rows, checking each control exists first; the coverage map marks rows as replayed or agent (microsoft/UFO, pywinauto/pywinauto).

### Notes

- User takeover pauses the loop: if the user moves the mouse mid-row, the row pauses as a handoff (CursorTouch/Windows-MCP). Medium, M.
- Wait for state, not time: replace fixed sleeps in the PowerShell actions with poll-until-element, 10 s cap (CursorTouch/Windows-MCP). Medium, S.
- Screenshot only the form window's rectangle, not the desktop (CursorTouch/Windows-MCP). Medium, S.
- Stop a loop that repeats itself: the same action on the same control 3 times in a row ends the row as a handoff (microsoft/UFO). Medium, S.
- Screenshot fallback only for blind spots: when UI Automation finds no control for a mapped field, fall back to a visual pick for that field only, flagged orange (microsoft/UFO). Low, M.

## Added requirement (M4-8)

Copy the selector patterns from pywinauto, Windows-MCP and UFO into the `desktop` plugin's PowerShell actions.

## Repo scan 2026-10-09

Relevant repos, top ideas and hardening for `form-fill-batch`: `ide-layer-research/m5-repo-scan-preview.md`, the section with the same name. Idea bank only; nothing there is built before launch (M5-D11).

Tag: M5 (after 12-01, per M5-D11). Nothing here is built before launch.

Fixture for every row: `tests/fixtures/form-fill-batch/input/form.ps1` with `rows.csv`. Rows that need a new
fixture switch name it. Codex writes the tests.

### Ideas

| Id | Idea, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| FF-I1 | Match columns to fields by accessible name, not screen position (sbroenne/mcp-windows, shanselman/FlaUI-MCP, pywinauto/pywinauto) | `map` | New `desktop` action `fields` (window, handle): lists the form's Edit, ComboBox and CheckBox controls with `Name`, `AutomationId` and `ControlType`. The `map` prompt calls it and matches each sheet column to a field by name; `rows.json` stores `AutomationId` and `Name` per field, never coordinates | Running `map` with the form at `-X 40` and again at `-X 600` writes the same field map in `rows.json` | 0.5 |
| FF-I2 | Set values through the value pattern, type only as a fallback (yinkaisheng/Python-UIAutomation-for-Windows, lahfir/agent-desktop) | `fill` | New `desktop` action `fill` (window, handle, values keyed by field `AutomationId`): sets each field with `ValuePattern.SetValue`; only a field with no value pattern gets focus plus typed keys. Returns `method` per field (`value` or `typed`). The `fill` prompt calls this action instead of typing | With another window in front of the form, `fill` on row 1 puts each value in its own field, and the output reports `value` for all three fields | 0.75 |
| FF-I3 | Capture the form window alone per row (remorses/usecomputer) | `shot` | Already true: `plugins/desktop/bin/desktop.ps1:34-46` crops to the window's `BoundingRectangle`, one PNG per handle. A covered window is FF-H5 | None new | 0 |
| FF-I4 | Read each field back after fill and diff against `rows.json` before the gate (shanselman/FlaUI-MCP, OpenAdaptAI/OpenAdapt) | new `readback` after the `fill`, `captcha`, `shot` loop, before `approve` | New `desktop` action `readback` (rows, out): for each filled row, finds the window by handle, reads every mapped field's current value and writes `readback.json` with `match` or the differing fields. The `approve` gate summary gains "N rows match, M differ" and names each differing row and field | Edit the Email box of row 2 by hand after `fill`; the `approve` summary reads "1 rows match, 1 differ" and names row 2, Email | 0.5 |
| FF-I5 | Replay log of every action as batch evidence (openai/openai-cua-sample-app, microsoft/skill-recorder) | `fill`, `submit` | Every `desktop` action that changes the form (`fill`, `submit`) appends one line per field or button to `<run_dir>/actions.jsonl`: row, handle, field, method, time. Replaying row 1 as a template is the M4-8 requirement above and is not repeated | After a two-row fixture run, `actions.jsonl` has 3 fill lines per row and 1 submit line per row | 0.5 |

Worked: 0.5 + 0.75 + 0 + 0.5 + 0.5 = 2.25 CC days.

### Hardening

| Id | Idea, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| FF-H1 | The agent tries to get past a captcha; detect only, never solve (mcp-windows detection aids) | `fill`, `captcha` | The hand-off already exists (`pipelines/form-fill-batch.json:34`, and the `fill` prompt forbids touching the captcha). New: `fields` (FF-I1) also returns `captcha: shown` when a visible control's name matches `captcha`; the runner opens the `captcha` gate when either that value or the agent's output says `shown`. No solver tool is ever added | Fixture with its captcha visible and the agent's `captcha` output forced to `none`: the `captcha` gate still waits | 0.4 |
| FF-H2 | A modal dialog hangs the call (shanselman/FlaUI-MCP) | `fill`, `submit`, `confirm` | One `Wait-Element` helper in `desktop.ps1` polls every 250 ms up to 10 s and replaces each direct find. Before acting on a window, the action checks for a modal child window; if one is open, the row fails with "modal dialog '<title>' open" | New fixture switch `-Modal` shows a message box on Submit; `submit` returns that row in `failed` with the dialog title in under 15 s, not at the 300 s action timeout | 0.5 |
| FF-H3 | Keystrokes land in the wrong window after focus moves (pywinauto/pywinauto) | `fill` | The handle per row is already recorded and used (`desktop.ps1:15-18`). New: in FF-I2's typed fallback, the action checks `GetForegroundWindow` equals the row's handle before each field and stops the row with "focus moved" when it does not | A second fixture window that takes focus during row 1's typed fallback: row 1 fails with "focus moved" and the second window's boxes stay empty | 0.3 |
| FF-H4 | A stuck key or crashed loop leaves input held down (openai/openai-cua-sample-app, AmrDab/clawdcursor) | `submit`, `fill` | `Press` (`desktop.ps1:63-71`) and the typed fallback release the mouse button and every pressed key in a `finally` block. Cancelling a run kills the PowerShell child through the existing kill-tree helper, and the next `desktop` action sends releases on start | A test that throws between mouse down and mouse up: `GetAsyncKeyState` for the left button reads up afterwards | 0.3 |
| FF-H5 | The UI is still settling when the check runs (AmrDab/clawdcursor, mediar-ai/terminator) | `shot`, `confirm` | `Read-Confirmations` drops its fixed 800 ms sleep (`desktop.ps1:91`) and polls each window until its text is the same on two reads 250 ms apart, 10 s cap. `Shot` brings the window to the front and checks that the window at the centre of its rectangle is the row's handle; after 3 tries it returns `obscured: true` and the `approve` summary lists that row | New fixture switch `-Delay 1500` changes the status text 1.5 s after Submit: `confirmations.json` holds the final text. A window placed over the form: `shot` returns `obscured: true` | 0.5 |

Worked: 0.4 + 0.5 + 0.3 + 0.3 + 0.5 = 2.0 CC days.
