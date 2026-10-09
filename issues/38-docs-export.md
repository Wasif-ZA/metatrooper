# `docs-export` plugin and `study-notes-to-pdf`

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

Part of the MetaTrooper epic. Milestone 3. Effort: about 1.5 Claude Code days.

Depends on: child #18, child #32.

## What

`docs-export` plugin and `study-notes-to-pdf`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Background. The run folds to the 36px wall bar with a small first-page thumbnail once the PDF exists.

- Layouts: preview-stage (page view), before-after (slide and note), artifact-columns (source chain), coverage-map
  (slide coverage), run-log (build log). Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens when the sign-off gate waits, a note line is still unsourced after the fix pass, the page proof loop hits
  max, or any step fails.
- Pick, first match: a failure or the proof loop at max to run-log; an unsourced line to before-after on its
  slide; the sign-off gate to preview-stage. Opened by hand: artifact-columns while notes are written,
  coverage-map while lines are checked, preview-stage while the PDF builds and when done.
- Steps: unconfirmed. This issue fixes the UI only and lists no steps.

## Acceptance criteria

- [ ] M3-01. Each milestone-3 built-in runs end to end on its fixture and stops at every gate before a publish step.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.

## Helper tools (M4-8)

| Helper | Repo | Licence | Risk | Egress | Step it helps |
|---|---|---|---|---|---|
| markitdown | microsoft/markitdown | MIT | OK | not checked (the markitdown-ocr plugin sends page images to an LLM) | ingest |
| docling | docling-project/docling | MIT | OK | not checked | ingest |
| typst | typst/typst | Apache-2.0 | OK | none (local compiler) | build PDF |
| pandoc | jgm/pandoc | GPL-2.0 | caution: GPL; fine as an external CLI, never bundled | none (local converter) | build PDF |

Helpers are optional. Each pipeline runs without them. They are listed in `pipelines/assists/registry.json` once the pipeline is built (registry format in `issues/m4-09-helper-tools.md`).

## Ideas (M4-8)

### Requirements

- Slide is the unit, speaker notes included: split ingest output on the `<!-- Slide number: N -->` markers into one chunk per slide with its notes; that list is the coverage map's rows (microsoft/markitdown).
- Page and box for every PDF line: keep each element's page and bounding box (`ProvenanceItem`); `before-after` highlights the exact box (docling-project/docling).
- Unsourced lines found in code: each note line carries a hidden source tag (`data-src` for the printToPDF path, `#metadata` with typst); proof lists lines with no tag without a model (typst/typst).

### Notes

- Check links in notes before signoff; `--offline` checks only local references (lycheeverse/lychee). Low, S.

## Added requirement (M4-8)

The steps of `study-notes-to-pdf` are still unconfirmed (issue 22 fixes the UI only). Helper and idea step names use the assumed flow: ingest, write notes, build PDF, proof. Confirm the real steps before building.

## Repo scan 2026-10-09

Relevant repos, top ideas and hardening for `study-notes-to-pdf`: `ide-layer-research/m5-repo-scan-preview.md`, the section with the same name. Idea bank only; nothing there is built before launch (M5-D11).
