# M8-16: Built-in workflows: find, live data, outline

Part of Ouros, Milestone 8. Build step added. Priority: Medium. Effort: not sized (sized after M8-0). Depends on: M8-4.

## Source of truth

- `ouros-spec.md` section 6e what is built in (rows 2, 7, 8); `spec.md` Milestone 8 children table row M8-16.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

Added 2026-10-31: the G plan builds the loops but no step owns the three workflow screens drawn for rows 2, 7 and 8. Row 7 is a hypothesis to test with real users.

Feature screens folded in (kit/specs): `f-find.json`, `f-data.json`, `f-outline.json`.

## Blocked on

- NEWFEATURES.html keep/change/drop on these three; STARTPOINT.html call 2 (row 7 for non-software engineers).

## Acceptance criteria

- [ ] M8-16a. Find project information and revisions (`f-find`): one search over files, specs, datasheets and design revisions, current revision marked.
- [ ] M8-16b. Live variables and DataFrames (`f-data`): a side view of live variables and tables while a script runs.
- [ ] M8-16c. Outline for notebooks and reports (`f-outline`): headings to jump to; sections whose numbers came from a changed calculation are marked; report view hides code.
- [ ] M8-16d. Each screen's spec (`f-find`, `f-data`, `f-outline`) passes `check.js` with nothing falling back and draws in the tab zone. (was: validates with validate.mjs)
  Status: PARTIAL. All three specs pass `check.js` today (2026-11-15). Drawing them in a tab is not tested.
  Verify: `node --input-type=module -e "import {expand} from './workbench/ui/src/kit/check.js'; import {readFileSync, readdirSync} from 'node:fs'; import {dirname, basename} from 'node:path'; const fs1=process.argv.slice(1).flatMap(a=>a.includes('*')?readdirSync(dirname(a)).filter(n=>n.startsWith(basename(a).split('*')[0])&&n.endsWith('.json')).map(n=>dirname(a)+'/'+n):[a]); let bad=0; for (const f of fs1) { const j=JSON.parse(readFileSync(f,'utf8')); const r=expand(j.spec??j); if (r.fellBack.length) { bad++; console.log(f, r.fellBack); } } process.exit(bad?1:0)" $HOME/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/specs/f-find.json $HOME/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/specs/f-data.json $HOME/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/specs/f-outline.json` from the repo root exits 0; tab drawing: to write, `workbench/test/m8-16-screens.test.ts` test "f-find, f-data and f-outline draw in a tab".

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
