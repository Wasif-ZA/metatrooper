# M8-10: Catalogue proposals

Part of Ouros, Milestone 8. Build step G10. Priority: Low. Effort: not sized (sized after M8-0). Depends on: M8-9.

## Source of truth

- `ouros-spec.md` section 5; `spec.md` Milestone 8 children table row M8-10.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

A part wanted by several screens is proposed as a catalogue change, never added by an agent.

## Acceptance criteria

- [ ] M8-10a. A part wanted by 3 screens appears as a proposal with its props and the screens that asked.
  Status: NOT STARTED.
  Verify: to write, `core/test/m8-10-proposals.test.ts` test "three surfaces falling back on the same unknown part make one proposal listing them".
- [ ] M8-10b. It ships only with tests in `core/test/m8-01-kit-check.test.ts` and `workbench/test/m8-01-kit-parts.test.ts`. (was: tests in check.mjs)
  Status: NOT STARTED as a rule. Today the parts test checks every name in `parts-*.names.js` has a fixture.
  Verify: `cd workbench; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="all 49 batch names have literal fixtures" test/m8-01-kit-parts.test.ts` passes after a part is added.
- [x] M8-10c. An unknown part stays a plain-text box naming it until shipped.
  Status: DONE.
  Verify: `cd core; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="ui.show reports and stores" test/m8-02-ui-surface.test.ts` (cases "mixed" and "unknown root": fellBack names the part, why "not in the catalogue").

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
