# M8-7: Learned profile and its "What Ouros learned" list in Settings > Learning

Part of Ouros, Milestone 8. Build step G7. Priority: Medium. Effort: not sized (sized after M8-0). Depends on: M8-6.

## Source of truth

- `ouros-spec.md` section 6, 6d; `spec.md` Milestone 8 children table row M8-7.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

Density, theme and parts he never opens. Every learned change has Undo and is replayed on past runs.

## Acceptance criteria

- [ ] M8-07a. Hide and density changes appear in Settings > Learning with Undo.
  Status: NOT STARTED.
  Verify: to write, `workbench/test/m8-07-profile.test.ts` test "a hide change shows in Settings > Learning and Undo restores the part".
- [ ] M8-07b. A profile cannot hide gate, choice, handback, pipe or layout parts (hidden-gate test).
  Status: NOT STARTED.
  Verify: to write, `core/test/m8-07-profile.test.ts` test "a profile hiding gate, choice, handback, pipe or layout is refused".
- [ ] M8-07c. One pending proposal at a time; nothing changes without his yes.
  Status: NOT STARTED.
  Verify: to write, `core/test/m8-07-profile.test.ts` test "a second proposal waits while one is pending, and an unanswered one changes nothing".

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
