# M8-J5: Meeting notes job screen

**After launch, add-on.** Part of Ouros, Milestone 8. Priority: Low. Effort: not sized until M8-0. Depends on: M8-11, M8-12, M8-14.
**Not before launch.** His words, 2026-11-05: job screens "will come after post launch".

## Source of truth

- Workspace: `~/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/workspaces/persona-t-notes.json`. Shot: `proto/shots/persona-t-notes.png`. Parts: `proto/kit/parts-job4b.js`.
- Also in the wip repo at `ouros/direction`.
- Notes: `proto/REPORT-job4b.md`; `research-ide/E/LAYOUTS.md` "notes"; `research-ide/E/MARKET.md`; `board.py` lists `N` and `DEMAND`.

## What it does

Primary product: Granola.
Your typed lines in white, added lines in grey. Three follow-ups, and an email held for your yes.

**This is a drawing today.** It needs a real engine or plugin behind it. None exists yet.
It also needs call audio, which Ouros does not capture.

| Borrowed part | From | Why |
|---|---|---|
| Transcript with speaker and time; follow-ups as tick boxes | Otter | Any line can be checked against what was said |
| Recap, Next steps, Summary, in that order | Zoom | People know where to look |

Differs: weakest reference, two crops and no full window. This is the most blended of the seven.

## Evidence

- Ramp Rate, November 2026: 10.5% buy AI notetakers, up 0.3 points in one month. One month is not a trend.

## Blocked on

- How audio is captured, and whether recording a call needs a notice to others on it. His call.
- Which transcript engine or plugin. His call. Seed list: ENGINES.html.

## Acceptance criteria

- [ ] M8-J5a. The workspace loads through `ouros_workspace` as an example with no refusal. (was: passes validate.mjs)
  Status: NOT STARTED. There is no workspace validator in the repo yet; `check.js` checks screens, not workspace layouts. Lands with M8-11.
  Verify: to write, `core/test/m8-11-workspace.test.ts` test "M8-J5a: the workspace loads through ouros_workspace with no refusal".
- [ ] M8-J5b. With no engine installed, the screen says so and shows an install card, never a demo meeting as real.
- [ ] M8-J5c. With a plugin installed, a real recording gives a transcript with speaker and time.
- [ ] M8-J5d. Every added line opens the transcript lines it came from.
- [ ] M8-J5e. An email waits at a real gate from M8-21.
- [ ] M8-J5f. No product name or logo shows on screen.

## Rules that bind every child

- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Job parts join the catalogue through M8-10, with tests.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
