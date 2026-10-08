# `desktop` plugin, handoff gate UI, `form-fill-batch`

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
