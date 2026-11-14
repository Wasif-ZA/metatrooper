# M8-F7: Find project information and revisions

Part of Ouros, Milestone 8, feature 7 of 12. Rides on: M8-16. Screen: `kit/specs/f-find.json`.

## Source of truth

- `ouros-spec.md` section 6e (6e row 2), "Features that make the loops visible".
- Scratch: `ouros-startpoint-2026-10-30/features/FEATURE-LIST.md` row A7; board `ouros-ide-fiveshot-2026-10-30/NEWFEATURES.html`; shot `kit/shots/features/f-find.png`.

## What it does

One search over files, specs, datasheets and design revisions, current revision marked

## Evidence

CAD users lose 1.3 h a week locating design data (1,466, 2023); broader: 55.75% of design engineers' time on acquiring or providing information (78, 2010); Overleaf multi-file search 157

## Blocked on

- Wasif's keep / change / drop on NEWFEATURES.html feature 7.

## Acceptance criteria

- [ ] M8-F7a. One search over files, specs, datasheets and design revisions, current revision marked.
- [ ] M8-F7b. The shipped screen matches `f-find.json`, and that spec passes `check.js` with nothing falling back. (was: passes validate.mjs)
  Status: PARTIAL. `f-find.json` passes `check.js` today (2026-11-15). The match with the shipped screen was not audited this pass.
  Verify: `node --input-type=module -e "import {expand} from './workbench/ui/src/kit/check.js'; import {readFileSync, readdirSync} from 'node:fs'; import {dirname, basename} from 'node:path'; const fs1=process.argv.slice(1).flatMap(a=>a.includes('*')?readdirSync(dirname(a)).filter(n=>n.startsWith(basename(a).split('*')[0])&&n.endsWith('.json')).map(n=>dirname(a)+'/'+n):[a]); let bad=0; for (const f of fs1) { const j=JSON.parse(readFileSync(f,'utf8')); const r=expand(j.spec??j); if (r.fellBack.length) { bad++; console.log(f, r.fellBack); } } process.exit(bad?1:0)" $HOME/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/specs/f-find.json` from the repo root exits 0; the screen match is checked by eye.

## Rules that bind every child

- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
