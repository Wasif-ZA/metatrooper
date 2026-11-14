# M8-J6: UI design and design-to-code job screen

**After launch, add-on.** Part of Ouros, Milestone 8. Priority: Low. Effort: not sized until M8-0. Depends on: M8-11, M8-12, M8-14.
**Not before launch.** His words, 2026-11-05: job screens "will come after post launch".

## Source of truth

- Workspace: `~/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/workspaces/persona-t-uidesign.json`. Shot: `proto/shots/persona-t-uidesign.png`. Parts: `proto/kit/parts-job4c.js`.
- Also in the wip repo at `ouros/direction`.
- Notes: `proto/REPORT-job4c.md`; `research-ide/E/LAYOUTS.md` "uidesign"; `research-ide/E/MARKET.md`; `board.py` lists `N` and `DEMAND`.

## What it does

Primary product: Figma, UI3 layout.
Four app screens on a canvas. The selected one becomes code, with a diff the agent will not write until you say yes.
This is the nearest of the seven to developers.

**This is a drawing today.** It needs a real engine or plugin behind it. None exists yet.

| Borrowed part | From | Why |
|---|---|---|
| Code under the properties | Figma Dev Mode | Design and code show together |
| Design, Prototype, Inspect tabs | Penpot | Code is one tab from design |

Differs: the agent column pushes the properties panel off the window edge. It mixes Figma's Design and Dev modes. Frame text and ruler ticks are not to scale.

## Evidence

- Ramp Rate, November 2026: 11.7% buy UI design tools, and Figma is 98% of those buyers.
- Figma Q3 revenue $391.4M, up 43%, by its own results.

## Blocked on

- Which engine or plugin holds the canvas. His call. Seed list: ENGINES.html. M8-29 holds design revision compare as a plugin.

## Acceptance criteria

- [ ] M8-J6a. The workspace loads through `ouros_workspace` as an example with no refusal. (was: passes validate.mjs)
  Status: NOT STARTED. There is no workspace validator in the repo yet; `check.js` checks screens, not workspace layouts. Lands with M8-11.
  Verify: to write, `core/test/m8-11-workspace.test.ts` test "M8-J6a: the workspace loads through ouros_workspace with no refusal".
- [ ] M8-J6b. With no engine installed, the screen says so and shows an install card, never demo frames as real.
- [ ] M8-J6c. With a plugin installed, a real design file opens.
- [ ] M8-J6d. No code is written until the person says yes to the diff.
- [ ] M8-J6e. No product name or logo shows on screen.

## Rules that bind every child

- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Job parts join the catalogue through M8-10, with tests.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
