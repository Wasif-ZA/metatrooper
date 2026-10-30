# M8-1: Move the kit into the repo with an o- class prefix

Part of Ouros, Milestone 8. Build step G1. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-0.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 5, 5b, 9; `spec.md` Milestone 8 children table row M8-1.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

kit.js, kit.css, ws.js and the 66 assets live in scratch and share one global scope with the round-3 screens. A top-level name clash blanks every screen (RESUME gotcha). The move fixes the scope and the class names.

## Acceptance criteria

- [ ] M8-01a. kit.js lives in the repo; render state is passed as an argument, not held in module globals.
- [ ] M8-01b. Every kit and asset class carries an `o-` prefix; no class from INVENTORY.md (.ph, .strip, .row, .meter) clashes with the host.
- [ ] M8-01c. Specs are stored as a flat map of parts by id; nested JSON is accepted and flattened on the way in.
- [ ] M8-01d. `check.mjs` (hostile inputs, 124 examples, asset fuzz) and `validate.mjs` (every spec; bad*.json refused) run in the repo's test command and pass.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
