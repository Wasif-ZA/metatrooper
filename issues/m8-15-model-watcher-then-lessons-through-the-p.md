# M8-15: Model watcher, then lessons through the proposal flow

Part of Ouros, Milestone 8. Build step G15. Priority: Low. Effort: not sized (sized after M8-0). Depends on: M8-13, M8-7.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 6e loops 2-3, 6d; `spec.md` Milestone 8 children table row M8-15.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

Last, because no study has tested lessons on one person's project over weeks. Read first: the replay gate in 2609.24130 and the skillbook in kayba-ai/agentic-context-engine (Apache-2.0).

Feature screens folded in (kit/specs): `f-lessons.json`.

## Blocked on

- STARTPOINT.html call 4 (model watcher).

## Acceptance criteria

- [ ] M8-15a. The model watcher stays only if its logged nudges beat its cost.
- [ ] M8-15b. A lesson becomes active only after replay and his yes; replay re-runs the agent, never scores a cached transcript.
- [ ] M8-15c. Removing a bad lesson by replay retires it and any lesson made from it.
- [ ] M8-15d. A lesson that changes no step is dropped; a corrupt store stays untouched and goes read-only.
- [ ] M8-15e. Lessons with proposals (`f-lessons`, held for later in FEATURE-LIST B) is drawn from this step's store.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
