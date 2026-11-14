# M8-J2: Graphic design job screen

**After launch, add-on.** Part of Ouros, Milestone 8. Priority: Low. Effort: not sized until M8-0. Depends on: M8-11, M8-12, M8-14.
**Not before launch.** His words, 2026-11-05: job screens "will come after post launch".

## Source of truth

- Workspace: `~/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/workspaces/persona-t-design.json`. Shot: `proto/shots/persona-t-design.png`. Parts: `proto/kit/parts-job4c.js`.
- Also in the wip repo at `ouros/direction`.
- Notes: `proto/REPORT-job4c.md`; `research-ide/E/LAYOUTS.md` "design"; `research-ide/E/MARKET.md`; `board.py` lists `N` and `DEMAND`.

## What it does

Primary product: Canva editor.
A real poster with the headline selected. The agent made 4 more sizes and waits before posting.

**This is a drawing today.** It needs a real engine or plugin behind it. None exists yet.

| Borrowed part | From | Why |
|---|---|---|
| Selection panel: Effects, Adjustments, Animation | Adobe Express | Answers "what can I do to this?" |
| Strip showing each size | Adobe Express | The sizes are the agent's work, so they stay visible |

Differs: no Canva image shows the page strip open, so that strip is an inference. Strip thumbnail text is too small to read.

## Evidence

- Ramp Rate, November 2026: 24.1% buy in this category, and Canva is 88% of those buyers.

## Blocked on

- Which engine or plugin does the design work. His call. Seed list: ENGINES.html.

## Acceptance criteria

- [ ] M8-J2a. The workspace loads through `ouros_workspace` as an example with no refusal. (was: passes validate.mjs)
  Status: NOT STARTED. There is no workspace validator in the repo yet; `check.js` checks screens, not workspace layouts. Lands with M8-11.
  Verify: to write, `core/test/m8-11-workspace.test.ts` test "M8-J2a: the workspace loads through ouros_workspace with no refusal".
- [ ] M8-J2b. With no engine installed, the screen says so and shows an install card, never a demo poster as real.
- [ ] M8-J2c. With a plugin installed, a real file opens and exports at each size.
- [ ] M8-J2d. A post waits at a real gate from M8-21.
- [ ] M8-J2e. No product name or logo shows on screen.

## Rules that bind every child

- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Job parts join the catalogue through M8-10, with tests.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
