# M8-J4: Slide deck job screen

**After launch, add-on.** Part of Ouros, Milestone 8. Priority: Low. Effort: not sized until M8-0. Depends on: M8-11, M8-12, M8-14.
**Not before launch.** His words, 2026-11-05: job screens "will come after post launch".

## Source of truth

- Workspace: `~/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/workspaces/persona-t-slides.json`. Shot: `proto/shots/persona-t-slides.png`. Parts: `proto/kit/parts-job4b.js`.
- Also in the wip repo at `ouros/direction`.
- Notes: `proto/REPORT-job4b.md`; `research-ide/E/LAYOUTS.md` "slides"; `research-ide/E/MARKET.md`; `board.py` lists `N` and `DEMAND`.

## What it does

Primary product: Google Slides.
A six-slide pitch to a hotel, open on the price slide. The agent waits before emailing it.

**This is a drawing today.** It needs a real engine or plugin behind it. None exists yet.

| Borrowed part | From | Why |
|---|---|---|
| Named toolbar groups | PowerPoint | Less guessing at icons |
| Agent says what it changed, beside the deck | Gamma | You can check its work slide by slide |

Differs: the far-right icon rail is gone, because Ouros has its own rail. Notes are 72 px, not 48. Thumbnail text is below 12 px, because they are scaled slides.

## Evidence

- Same office-suite demand as M8-J3. No source measures slides alone.
- Gamma says $100M ARR and 70M+ users, a founder's figure from November 2025, so it is a year old.

## Blocked on

- Which engine or plugin reads and writes the deck. His call. Seed list: ENGINES.html.

## Acceptance criteria

- [ ] M8-J4a. The workspace loads through `ouros_workspace` as an example with no refusal. (was: passes validate.mjs)
  Status: NOT STARTED. There is no workspace validator in the repo yet; `check.js` checks screens, not workspace layouts. Lands with M8-11.
  Verify: to write, `core/test/m8-11-workspace.test.ts` test "M8-J4a: the workspace loads through ouros_workspace with no refusal".
- [ ] M8-J4b. With no engine installed, the screen says so and shows an install card, never a demo deck as real.
- [ ] M8-J4c. With a plugin installed, a real deck opens and exports.
- [ ] M8-J4d. An email waits at a real gate from M8-21.
- [ ] M8-J4e. No product name or logo shows on screen.

## Rules that bind every child

- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Job parts join the catalogue through M8-10, with tests.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
