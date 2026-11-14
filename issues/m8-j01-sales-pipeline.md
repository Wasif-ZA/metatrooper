# M8-J1: Sales pipeline job screen

**After launch, add-on.** Part of Ouros, Milestone 8. Priority: Low. Effort: not sized until M8-0. Depends on: M8-11, M8-12, M8-14.
**Not before launch.** His words, 2026-11-05: job screens "will come after post launch".

## Source of truth

- Workspace: `~/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/workspaces/persona-t-crm.json`. Shot: `proto/shots/persona-t-crm.png`. Parts: `proto/kit/parts-job4a.js`.
- Also in the wip repo at `ouros/direction`.
- Notes: `proto/REPORT-job4a.md`; `research-ide/E/LAYOUTS.md` "crm"; `research-ide/E/MARKET.md`; `board.py` lists `N` and `DEMAND`.

## What it does

Primary product: Salesforce Lightning opportunity board.
Deals by stage. The agent spots a deal gone quiet for 13 days and drafts an email. Nothing goes until you say yes.

**This is a drawing today.** It needs a real engine or plugin behind it. None exists yet.

| Borrowed part | From | Why |
|---|---|---|
| Weighted total at the foot of each stage | HubSpot | Shows what a stage is worth without opening anything |
| Age on each card | Attio | A quiet deal stands out |

Differs: the Salesforce image is from about 2019 and cropped, so its top navigation is not drawn.

## Evidence

- Ramp Rate, November 2026: 25.0% of businesses on Ramp buy a CRM. It counts buyers, in the US, and skews to tech.

## Blocked on

- Which engine or plugin holds the deals. His call. Seed list: ENGINES.html.

## Acceptance criteria

- [ ] M8-J1a. The workspace loads through `ouros_workspace` as an example with no refusal. (was: passes validate.mjs)
  Status: NOT STARTED. There is no workspace validator in the repo yet; `check.js` checks screens, not workspace layouts. Lands with M8-11.
  Verify: to write, `core/test/m8-11-workspace.test.ts` test "M8-J1a: the workspace loads through ouros_workspace with no refusal".
- [ ] M8-J1b. With no engine installed, the screen says so and shows an install card, never demo deals as real.
- [ ] M8-J1c. With a plugin installed, real records fill the board.
- [ ] M8-J1d. An email waits at a real gate from M8-21.
- [ ] M8-J1e. No product name or logo shows on screen.

## Rules that bind every child

- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Job parts join the catalogue through M8-10, with tests.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
