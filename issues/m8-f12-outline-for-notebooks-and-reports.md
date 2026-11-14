# M8-F12: Outline for notebooks and reports

Part of Ouros, Milestone 8, feature 12 of 12. Rides on: M8-16. Screen: `kit/specs/f-outline.json`.

## Source of truth

- `ouros-spec.md` section 6e (6e rows 7, 8), "Features that make the loops visible".
- Scratch: `ouros-startpoint-2026-10-30/features/FEATURE-LIST.md` row A12; board `ouros-ide-fiveshot-2026-10-30/NEWFEATURES.html`; shot `kit/shots/features/f-outline.png`.

## What it does

Headings to jump to; sections whose numbers came from a changed calculation are marked; report view hides code

## Evidence

notebook outline 314 (shipped in VS Code, so expected rather than new)

## Blocked on

- Wasif's keep / change / drop on NEWFEATURES.html feature 12.

## Acceptance criteria

- [ ] M8-F12a. Headings to jump to.
- [ ] M8-F12b. sections whose numbers came from a changed calculation are marked.
- [ ] M8-F12c. report view hides code.
- [ ] M8-F12d. The shipped screen matches `f-outline.json`, and that spec passes `check.js` with nothing falling back. (was: passes validate.mjs)
  Status: PARTIAL. `f-outline.json` passes `check.js` today (2026-11-15). The match with the shipped screen was not audited this pass.
  Verify: `node --input-type=module -e "import {expand} from './workbench/ui/src/kit/check.js'; import {readFileSync, readdirSync} from 'node:fs'; import {dirname, basename} from 'node:path'; const fs1=process.argv.slice(1).flatMap(a=>a.includes('*')?readdirSync(dirname(a)).filter(n=>n.startsWith(basename(a).split('*')[0])&&n.endsWith('.json')).map(n=>dirname(a)+'/'+n):[a]); let bad=0; for (const f of fs1) { const j=JSON.parse(readFileSync(f,'utf8')); const r=expand(j.spec??j); if (r.fellBack.length) { bad++; console.log(f, r.fellBack); } } process.exit(bad?1:0)" $HOME/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/specs/f-outline.json` from the repo root exits 0; the screen match is checked by eye.

## Rules that bind every child

- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
