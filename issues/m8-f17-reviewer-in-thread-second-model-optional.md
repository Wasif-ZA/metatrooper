# M8-F17: Reviewer nested in the thread, second model optional, cost shown

Part of Ouros, Milestone 8, feature 17. Rides on: M8-26. Screen: `proto/kit/workspaces/n04-turn-reviewer.json`, shot `proto/shots/n04-turn-reviewer.png`.
Effort: not sized until M8-0.
**Start on or after 2026-11-09.**

Grouped: "Agent asks another agent, shown nested under it" is built here, because the review is its first use.

## Source of truth

- `spec.md` Milestone 8, "Direction, 2026-11-05"; `ouros-spec.md` section 6e, reviewer line in loop 1.
- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/` (also `ouros/direction` in the wip repo): `core/CORE.html` row "Second model, optional"; `research-ide/F/RIVALS.md` row 7.

## What it does

The work folds away inside the thread.
The reviewer sits under the turn it checked.
Its findings read as Both agree, one engine only, and Disagree, in plain words.
A second model is off by default.
One click starts it, and its cost shows first, labelled an estimate.

## Evidence

- CORE.html: the cost is untested, so it stays off by default.
- Matched by rivals. openai/codex-plugin-cc (34,890 stars) blocks a Claude stop on a Codex review. Copilot CLI's Rubber Duck uses a different model family (RIVALS.md row 7).
- Today only `skills/second-opinion` exists. The runner left in M6-1. The old note that two-engine review already runs is stale.

## Blocked on

- Whether agents may ask other agents for anything beyond review in the first build. His call.
- "Fresh reviewer" in the deep-dive calls (M8-13). His call. Section 6e says a reviewer reads before hand-back. Off by default narrows that.

## What gets built

Not sized until M8-0.

| # | Change | Reuses |
|---|---|---|
| 1 | Nested child run in the thread | Parts `childrun`, `worked`, `msg`; M7-14 subagents under a tile |
| 2 | Start button with an estimate before it runs | M8-26 pre-review button; M7-23 prices |
| 3 | Findings grouped by agreement | M8-26b inline findings |

## Acceptance criteria

- [ ] M8-F17a. On a fresh install, no second model runs without a click.
- [ ] M8-F17b. The estimate shows before the run and is labelled an estimate.
- [ ] M8-F17c. The reviewer's run shows nested under the turn it reviewed, folded by default.
- [ ] M8-F17d. A reviewer's verdict never changes the run's result. It is a hint, not the judge (6e).
- [ ] M8-F17e. With no second engine installed, the button says so and starts nothing.
- [ ] M8-F17f. The shipped screen matches `n04-turn-reviewer.json` and passes validate.mjs.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
