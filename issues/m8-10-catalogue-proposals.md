# M8-10: Catalogue proposals

Part of Ouros, Milestone 8. Build step G10. Priority: Low. Effort: not sized (sized after M8-0). Depends on: M8-9.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 5; `spec.md` Milestone 8 children table row M8-10.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

A part wanted by several screens is proposed as a catalogue change, never added by an agent.

## Acceptance criteria

- [ ] M8-10a. A part wanted by 3 screens appears as a proposal with its props and the screens that asked.
- [ ] M8-10b. It ships only with tests in check.mjs.
- [ ] M8-10c. An unknown part stays a plain-text box naming it until shipped.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
