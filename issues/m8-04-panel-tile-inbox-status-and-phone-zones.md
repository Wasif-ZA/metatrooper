# M8-4: Panel, tile, inbox, status and phone zones

Part of Ouros, Milestone 8. Build step G4. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-3.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 4; `spec.md` Milestone 8 children table row M8-4.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

The same JSON draws in every IDE place. Each zone has a size and a list of parts it accepts.

## Blocked on

- Phone round 2 verdict (PHONE.html) before the phone zone is styled.

## Acceptance criteria

- [ ] M8-04a. A zone matrix in the repo lists which parts each zone accepts (status: text, kbd, time; inbox: one line plus one action).
- [ ] M8-04b. A part a zone cannot hold folds to its first line with "open".
- [ ] M8-04c. Long tables, lists and queues show 50 rows with a "more" event.
- [ ] M8-04d. The phone zone folds columns to one.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
