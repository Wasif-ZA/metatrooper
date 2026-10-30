# M8-9: Screen maker role and asset store

Part of Ouros, Milestone 8. Build step G9. Priority: Medium. Effort: not sized (sized after M8-0). Depends on: M8-4.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 6b, 7; `spec.md` Milestone 8 children table row M8-9.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

For any request, a screen maker researches how good apps show that task and builds the screen from the catalogue.

## Acceptance criteria

- [ ] M8-09a. A non-developer request produces a validated screen with cited sources in under 15 minutes.
- [ ] M8-09b. A repeat request uses its template and skips research.
- [ ] M8-09c. Research leaks nothing: a canary file's text never appears in a search query.
- [ ] M8-09d. Templates and assets belong to one workspace.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
