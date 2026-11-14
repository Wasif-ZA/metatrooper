# M8-6: Templates mined from his transcripts

Part of Ouros, Milestone 8. Build step G6. Priority: Medium. Effort: not sized (sized after M8-0). Depends on: M8-2.

## Source of truth

- `ouros-spec.md` section 6; `spec.md` Milestone 8 children table row M8-6.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

Screens learned from his own workflows. A template is kept only if replay on past runs shows it helps.

## Acceptance criteria

- [ ] M8-06a. 3 templates are proposed from Wasif's own transcripts.
  Status: NOT STARTED.
  Verify: to write, `core/test/m8-06-templates.test.ts` test "three synthetic transcripts with one repeated screen produce one proposed template".
- [ ] M8-06b. Each is kept only after replay on past runs.
  Status: NOT STARTED.
  Verify: to write, `core/test/m8-06-templates.test.ts` test "a template that loses on replay is dropped".
- [ ] M8-06c. A filled template is re-validated through `check.js`; nesting stops at 3 levels (template injection tests in `core/test/m8-01-kit-check.test.ts`). (was: injection tests in check.mjs)
  Status: NOT STARTED.
  Verify: to write, `core/test/m8-01-kit-check.test.ts` test "a filled template is re-checked and a fourth nesting level is cut".

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
