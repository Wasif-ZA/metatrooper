# M8-8: Streaming and data updates (A2UI style)

Part of Ouros, Milestone 8. Build step G8. Priority: Medium. Effort: not sized (sized after M8-0). Depends on: M8-4.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 3; `spec.md` Milestone 8 children table row M8-8.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

`create`, `parts`, `data`, `delete` messages. A half-sent screen draws; a live value updates without resending parts.

## Acceptance criteria

- [ ] M8-08a. The binding from a `data` path to a part's prop is written in ouros-spec.md with one meter example.
- [ ] M8-08b. A half-sent screen draws; a child id not yet arrived draws as `spinner`.
- [ ] M8-08c. A token counter updates through `data` without resending parts.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
