# M8-4: Panel, tile, inbox, status and phone zones

Part of Ouros, Milestone 8. Build step G4. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-3.

## Source of truth

- `ouros-spec.md` section 4; `spec.md` Milestone 8 children table row M8-4.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

The same JSON draws in every IDE place. Each zone has a size and a list of parts it accepts.

## Blocked on

- Phone round 2 verdict (PHONE.html) before the phone zone is styled.

## Acceptance criteria

As built: only the tab zone exists. `ui.show` refuses every other zone with -32602 (`core/test/m8-02-ui-surface.test.ts`, "non-tab zone").

- [ ] M8-04a. A zone matrix in the repo lists which parts each zone accepts (status: text, kbd, time; inbox: one line plus one action).
  Status: NOT STARTED.
  Verify: to write, `core/test/m8-04-zones.test.ts` test "status zone accepts text, kbd and time only; inbox accepts one line plus one action".
- [ ] M8-04b. A part a zone cannot hold folds to its first line with "open".
  Status: NOT STARTED.
  Verify: to write, `workbench/test/m8-04-zones.test.ts` test "a table in the status zone draws its first line and an open button".
- [ ] M8-04c. Long tables, lists and queues show 50 rows with a "more" event.
  Status: PARTIAL. Tables stop at 200 rows (`MAX_ROWS` in `check.js`) and draw "N more rows not drawn". There is no 50-row page and no "more" event, and lists and queues have their own caps.
  Verify (passes now): `cd core; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="200-row cap" test/m8-01-kit-check.test.ts` (2 tests).
  Verify (to write): `workbench/test/m8-04-zones.test.ts` test "a 120-row table, list and queue each draw 50 rows and a more button that sends a more event".
- [ ] M8-04d. The phone zone folds columns to one.
  Status: NOT STARTED.
  Verify: to write, `workbench/test/m8-04-zones.test.ts` test "columns in the phone zone draw as one column".

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
