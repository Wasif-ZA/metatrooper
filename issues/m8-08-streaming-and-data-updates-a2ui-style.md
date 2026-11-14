# M8-8: Streaming and data updates (A2UI style)

Part of Ouros, Milestone 8. Build step G8. Priority: Medium. Effort: not sized (sized after M8-0). Depends on: M8-4.

## Source of truth

- `ouros-spec.md` section 3; `spec.md` Milestone 8 children table row M8-8.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

`create`, `parts`, `data`, `delete` messages. A half-sent screen draws; a live value updates without resending parts.

## Acceptance criteria

As built: `ui.show` replaces the whole spec each call and bumps `seq`. There are no `create`, `parts`, `data` or `delete` messages. The flat parts map from M8-01c is ready for them.

- [ ] M8-08a. The binding from a `data` path to a part's prop is written in ouros-spec.md with one meter example.
  Status: NOT STARTED.
  Verify: `Select-String ouros-spec.md -Pattern 'data path'` finds the binding rule with a meter example.
- [ ] M8-08b. A half-sent screen draws; a child id not yet arrived draws as `spinner`.
  Status: NOT STARTED. Today a missing child id draws as a text box, "no part with id" (`core/test/m8-01-kit-check.test.ts`, "missing and inherited references fall back locally").
  Verify: to write, `core/test/m8-01-kit-check.test.ts` test "a child id not yet sent expands to a spinner, not a fallback".
- [ ] M8-08c. A token counter updates through `data` without resending parts.
  Status: NOT STARTED.
  Verify: to write, `core/test/m8-08-data.test.ts` test "ui.data changes a meter value and leaves the stored parts unchanged".

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
