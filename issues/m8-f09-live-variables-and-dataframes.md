# M8-F9: Live variables and DataFrames

Part of Ouros, Milestone 8, feature 9 of 12. Rides on: M8-16. Screen: `kit/specs/f-data.json`.

## Source of truth

- `ouros-spec.md` section 6e (6e row 7), "Features that make the loops visible".
- Scratch: `ouros-startpoint-2026-10-30/features/FEATURE-LIST.md` row A9; board `ouros-ide-fiveshot-2026-10-30/NEWFEATURES.html`; shot `kit/shots/features/f-data.png`.

## What it does

A side view of live variables and tables while a script runs; summaries (types, empties) are a hypothesis

## Evidence

DataFrame debugger 360 (later shipped in VS Code); variable explorer 185; inspector 118

## Blocked on

- Wasif's keep / change / drop on NEWFEATURES.html feature 9.

## Acceptance criteria

- [ ] M8-F9a. A side view of live variables and tables while a script runs.
- [ ] M8-F9b. summaries (types, empties) are a hypothesis.
- [ ] M8-F9c. The shipped screen matches `f-data.json`, and that spec passes `check.js` with nothing falling back. (was: passes validate.mjs)
  Status: PARTIAL. `f-data.json` passes `check.js` today (2026-11-15). The match with the shipped screen was not audited this pass.
  Verify: `node --input-type=module -e "import {expand} from './workbench/ui/src/kit/check.js'; import {readFileSync, readdirSync} from 'node:fs'; import {dirname, basename} from 'node:path'; const fs1=process.argv.slice(1).flatMap(a=>a.includes('*')?readdirSync(dirname(a)).filter(n=>n.startsWith(basename(a).split('*')[0])&&n.endsWith('.json')).map(n=>dirname(a)+'/'+n):[a]); let bad=0; for (const f of fs1) { const j=JSON.parse(readFileSync(f,'utf8')); const r=expand(j.spec??j); if (r.fellBack.length) { bad++; console.log(f, r.fellBack); } } process.exit(bad?1:0)" $HOME/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/specs/f-data.json` from the repo root exits 0; the screen match is checked by eye.

## Rules that bind every child

- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
