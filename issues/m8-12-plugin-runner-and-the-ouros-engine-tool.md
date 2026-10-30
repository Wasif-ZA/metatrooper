# M8-12: Plugin runner and the ouros_engine tool

Part of Ouros, Milestone 8. Build step G12. Priority: Medium. Effort: not sized (sized after M8-0). Depends on: M8-14.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 5c, 6e; `spec.md` Milestone 8 children table row M8-12.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

Engines behind an asset run as plugins. ENGINES.html (101 rows) is the seed plugin list, not build scope.

## Blocked on

- ENGINES.html's 5 calls (linked libs failing the gate, bundle vs user-install, FreeCAD vs build123d, cross-origin isolation, social posting).

## Acceptance criteria

- [ ] M8-12a. Whisper captions fill a screening surface through `binds` with no agent re-send.
- [ ] M8-12b. A publish action stops at a real gate.
- [ ] M8-12c. A missing engine shows its install card.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
