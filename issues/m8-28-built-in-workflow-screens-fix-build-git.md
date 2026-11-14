# M8-28: Built-in workflow screens: fix, build, git and hand-back, refactor, tests and docs

Part of Ouros, Milestone 8. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-2, M8-4.
Status in scratch: decided (ouros-spec.md 6e rows 1, 3-6); screens drawn.

## Source of truth

- `spec.md` Milestone 8 row M8-28; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): kit/specs/p-*.json (17, e.g. p-spec-to-pr, p-two-engine-review, p-security-review-and-upgrade, p-website-build, p-e2e-browser-qa); polish/B.md.

## What was designed

- M8-16 owns rows 2, 7 and 8. This owns rows 1 and 3 to 6: the 17 pipeline screens drawn as kit JSON.
- Non-software screens (p-footage-to-edit, p-study-notes-to-pdf, p-prospect-list-to-drafts and others) ship as persona examples, not built-in work.

## Acceptance criteria

- [ ] M8-28a. Every p-*.json passes `check.js` with nothing falling back and draws in the tab zone. (was: passes validate.mjs)
  Status: PARTIAL. 3 of 17 pass today (2026-11-15). 13 fall back on `gate` and p-two-engine-review on `tile`, because those parts are not drawn yet.
  Verify: `node --input-type=module -e "import {expand} from './workbench/ui/src/kit/check.js'; import {readFileSync, readdirSync} from 'node:fs'; import {dirname, basename} from 'node:path'; const fs1=process.argv.slice(1).flatMap(a=>a.includes('*')?readdirSync(dirname(a)).filter(n=>n.startsWith(basename(a).split('*')[0])&&n.endsWith('.json')).map(n=>dirname(a)+'/'+n):[a]); let bad=0; for (const f of fs1) { const j=JSON.parse(readFileSync(f,'utf8')); const r=expand(j.spec??j); if (r.fellBack.length) { bad++; console.log(f, r.fellBack); } } process.exit(bad?1:0)" $HOME/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/specs/p-*.json` from the repo root exits 0.
- [ ] M8-28b. Each software workflow ends in a check result bound to the run; no "done" without evidence (M8-F1).
- [ ] M8-28c. No agent-written HTML anywhere in these screens.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
