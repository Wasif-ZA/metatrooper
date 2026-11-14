# M8-F10: Plugin grants, updates and revocation

Part of Ouros, Milestone 8, feature 10 of 12. Rides on: M8-14. Screen: `kit/specs/f-plugin.json`.

## Source of truth

- `ouros-spec.md` section 6e (6e plugins), "Features that make the loops visible".
- Scratch: `ouros-startpoint-2026-10-30/features/FEATURE-LIST.md` row A10; board `ouros-ide-fiveshot-2026-10-30/NEWFEATURES.html`; shot `kit/shots/features/f-plugin.png`.

## What it does

Install sheet with enforced grants and the text a plugin adds; pinned artifact; an update with changed commands or wider access asks again, every version is scanned; a remote block list disables a plugin, says why and revokes its grants

## Evidence

283 malicious ids in VS Code's block feed; postmark-mcp sleeper update; 73 + 77 Open VSX attacks

## Blocked on

- Wasif's keep / change / drop on NEWFEATURES.html feature 10.

## Acceptance criteria

- [ ] M8-F10a. Install sheet with enforced grants and the text a plugin adds.
- [ ] M8-F10b. pinned artifact.
- [ ] M8-F10c. an update with changed commands or wider access asks again, every version is scanned.
- [ ] M8-F10d. a remote block list disables a plugin, says why and revokes its grants.
- [ ] M8-F10e. The shipped screen matches `f-plugin.json`, and that spec passes `check.js` with nothing falling back. (was: passes validate.mjs)
  Status: PARTIAL. `f-plugin.json` passes `check.js` today (2026-11-15). The match with the shipped screen was not audited this pass.
  Verify: `node --input-type=module -e "import {expand} from './workbench/ui/src/kit/check.js'; import {readFileSync, readdirSync} from 'node:fs'; import {dirname, basename} from 'node:path'; const fs1=process.argv.slice(1).flatMap(a=>a.includes('*')?readdirSync(dirname(a)).filter(n=>n.startsWith(basename(a).split('*')[0])&&n.endsWith('.json')).map(n=>dirname(a)+'/'+n):[a]); let bad=0; for (const f of fs1) { const j=JSON.parse(readFileSync(f,'utf8')); const r=expand(j.spec??j); if (r.fellBack.length) { bad++; console.log(f, r.fellBack); } } process.exit(bad?1:0)" $HOME/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/specs/f-plugin.json` from the repo root exits 0; the screen match is checked by eye.

## Rules that bind every child

- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
