# M5-18 Launch catalogue: four built-ins, the rest preview

Child of Milestone 5 in `spec.md`. Tag: BLOCKER (ships 2026-12-01). Effort 0.5 CC days. Decided M5-D1, M5-D2, M5-D3 (Codex and Gemini
both A, 2026-10-09). Evidence: `ide-layer-research/m5-demand.md`.

## What changes

| Group | Pipelines | At launch |
|---|---|---|
| Built-in | spec-to-pr, spec-build-review-handback, two-engine-review, e2e-browser-qa, and pr-review-fix (Pro, M5-6) | seeded and shown as built-ins |
| Preview | footage-to-edit, website-build, design-variants, docs-and-release-notes, security-review-and-upgrade, clips-to-scheduled-posts, seo-audit-fix, deep-research-cited, data-to-dashboard, form-fill-batch | move to `pipelines/preview/`; listed in the template gallery with a "preview" label; runnable only after the user adds one |
| Not shipped | prospect-list-to-drafts, inbox-triage-drafts, study-notes-to-pdf | move to `pipelines/unshipped/`; not in the gallery or the installer; files and tests kept |

Nothing is deleted. Their plugins stay installed and their wiring tests keep running.

Features frozen as they are (M5-D3): inspiration board, variants grid, agent cursors, and 12 of the 15 run layouts.
No new work and no marketing; a bug is fixed only when it breaks a built-in pipeline. The three layouts that keep
getting work are the ones the built-ins open on: `run-log`, `duel`, `hand-back`.

Cut from the plan (M5-D10): the Tauri tray (#41, and the tray half of #42) and TOON output (M4-5). Their issue files
move to `issues/archive/` with a closing note; GitHub #41 is closed as not planned by Wasif.

## Files

- `core/src/pipelines/store.ts`: seed only `pipelines/*.json`; `template.list` also reads `pipelines/preview/` with
  `preview: true`.
- Move the 13 pipeline files and their code folders; update `core/test/m3-e2e.test.ts` paths.
- `workbench/test/*`: fixtures that load a moved pipeline by path.

## Acceptance criteria

- M5-18a. A fresh core seeds exactly the 5 built-ins.
- M5-18b. `template.list` returns the 10 preview pipelines with `preview: true` and none of the 3 unshipped ones.
- M5-18c. `core/test/m3-e2e.test.ts` still passes for every moved pipeline.
