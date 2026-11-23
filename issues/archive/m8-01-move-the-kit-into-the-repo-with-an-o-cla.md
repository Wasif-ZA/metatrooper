# M8-1: Move the kit into the repo with an o- class prefix

Part of Ouros, Milestone 8. Build step G1. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-0.

## Source of truth

- `ouros-spec.md` section 5, 5b, 9; `spec.md` Milestone 8 children table row M8-1.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

kit.js, kit.css, ws.js and the 66 assets live in scratch and share one global scope with the round-3 screens. A top-level name clash blanks every screen (RESUME gotcha). The move fixes the scope and the class names.

## Acceptance criteria

As built (D84): the kit is React on @astryxdesign/core in `workbench/ui/src/kit/` (`catalogue.js`, `check.js`, `Draw.jsx`, `DrawnTabs.jsx`, `parts-a.jsx` to `parts-e.jsx`). Core imports `check.js` to check a spec in `ui.show`.

- [x] M8-01a. The kit lives in `workbench/ui/src/kit/`; limits and state live inside each `expand` call, not in module globals. (was: kit.js lives in the repo, render state passed as an argument)
  Status: DONE.
  Verify: `cd core; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="budgets reset on the next call" test/m8-01-kit-check.test.ts` (1 test, passes).
- [x] M8-01b. Every class the kit's own CSS defines carries an `ou-` prefix; only recharts' own classes do not. (was: every kit and asset class carries an `o-` prefix)
  Status: DONE.
  Verify: from the repo root, `node -e "const fs=require('fs'),d='workbench/ui/src/kit/';const bad=fs.readdirSync(d).filter(f=>f.endsWith('.css')).flatMap(f=>[...fs.readFileSync(d+f,'utf8').matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m=>m[1])).filter(c=>!/^(ou-|recharts-)/.test(c));if(bad.length){console.log(bad);process.exit(1)}"` exits 0.
- [x] M8-01c. `check.js` flattens a nested spec into a flat map of parts by id at check time, and a flat spec passes through; core stores the spec as the agent sent it. (was: specs are stored as a flat map of parts by id)
  Status: DONE.
  Verify: `cd core; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="flatten hoists|flat parts pass through" test/m8-01-kit-check.test.ts` (2 tests, pass).
- [x] M8-01d. `core/test/m8-01-kit-check.test.ts` (checker: hostile inputs, limits, every catalogue part) and `workbench/test/m8-01-kit-draw.test.ts` plus `m8-01-kit-parts.test.ts` (renderer: hostile inputs, all 49 batch parts) run and pass. (was: check.mjs and validate.mjs run in the repo's test command)
  Status: DONE. 134 core tests (with m8-02) and 398 workbench tests pass on 2026-11-15.
  Verify: `cd core; node --test --test-isolation=none --test-timeout=120000 test/m8-01-kit-check.test.ts`, then `cd workbench; node --test --test-isolation=none --test-timeout=120000 test/m8-01-kit-draw.test.ts test/m8-01-kit-parts.test.ts`.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
