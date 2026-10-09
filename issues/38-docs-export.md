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

Tag: M5 (after 12-01, per M5-D11). Nothing here is built before launch.

The real steps are now known (`pipelines/study-notes-to-pdf.json`): `ingest`, `outline`, `notes`, `check`, `export`,
`proof` (loops with `export`, max 2), `signoff`. Fixture: `tests/fixtures/study-notes-to-pdf/input/lecture.pdf`.
SN-I2, SN-I3, SN-I5 and SN-H4 share one code file, `pipelines/study-notes-to-pdf/cites.mjs`; build them together.
Codex writes the tests.

### Ideas

| Id | Idea, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| SN-I1 | Tell text pages from scanned pages and OCR only the scanned ones (firecrawl/pdf-inspector, ocrmypdf/OCRmyPDF) | `ingest` | `ingest` already lists pages with no text (`plugins/docs-export/bin/docs-export.js:27`). New: a page with under 20 characters counts as scanned. When `ocrmypdf` is on PATH, those pages alone go through `ocrmypdf --skip-text` and are read again with `pdftotext`; without it, the page file says "scanned page, no text" and the output gains `scanned: [page numbers]`, which the `outline` prompt is told about | New fixture PDF with page 3 as an image only: output has `scanned: [3]`; with `ocrmypdf` installed, `p3.txt` holds the page's words | 0.75 |
| SN-I2 | Every line carries a slide cite, and a slide no line cites fails the check (yukunou703/studyproof, ZelinZhou-THU/lecture-notes-creator) | new code step `cites` after `notes` | `cites.mjs` reads `notes.md` and `slides/`, lists lines with no `p.N` and slides no line cites, writes `cites.json` and outputs both counts. The `check` prompt gets the two lists; `check.passed` reads false while a slide is uncited and not skipped with a reason in `CHECK.md` | A fixture `notes.md` with no line citing slide 2: `cites.json` lists slide 2 and `check.passed` is false | 0.5 |
| SN-I3 | Mark unverifiable lines instead of keeping them, and keep a claim ledger (yukunou703/studyproof, AgriciDaniel/claude-obsidian) | `check` | The `check` prompt writes `CHECK.md` as a table with one row per notes line: cite, verdict (`ok`, `rewritten`, `cut`, `unverified`). A line it cannot source after one rewrite stays in `notes.md` tagged `(unverified)` and is never kept silently. `cites.mjs` checks the ledger has one row per line | On the fixture run, the ledger row count equals the line count of `notes.md` | 0.4 |
| SN-I4 | Drive the PDF from one Markdown file with print CSS and a fixed template (simonhaenisch/md-to-pdf, fnando/kitabu) | `export` | Already true: `docs-export.js:89-96` builds the PDF from `notes.md` plus `print.css` on a fixed base style with `@page` size and margins. Page-break rules are SN-H1 | None new | 0 |
| SN-I5 | Map sections to slide ranges first so a missing topic shows before notes are written (EricKart/AI901-Study-Kit) | `outline`, then `cites` run once after it | The `outline` prompt already asks for the slides each section covers. New: it ends `outline.md` with a fenced JSON block, `{"sections": [{"title", "slides": [from, to]}]}`. `cites.mjs` runs in outline mode, lists slides in no range as `gaps`, and the `notes` prompt receives them | A fixture `outline.md` that leaves out slide 4: the run shows `gaps: [4]` before `notes` starts | 0.4 |

Worked: 0.75 + 0.5 + 0.4 + 0 + 0.4 = 2.05 CC days.

### Hardening

| Id | Idea, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| SN-H1 | A table or worked example splits across a page break (simonhaenisch/md-to-pdf, fnando/kitabu) | `export` | The base style in `exportPdf` (`docs-export.js:96`) gains `table, pre, blockquote { break-inside: avoid }` and `h1, h2, h3 { break-after: avoid }`, so the `proof` loop starts from a sane default | A fixture `notes.md` whose 12-row table starts near the foot of page 1: `pdftotext` shows all 12 rows on one page | 0.25 |
| SN-H2 | OCR garbles tables and maths or repeats headers (datalab-to/marker, chatdoc-com/OCRFlux) | `ingest` | After the split, a line that appears on more than 60% of pages is removed from each page file and written once to `slides/_removed.txt`. When `docling` is installed (already a listed helper), scanned pages from SN-I1 go through it so tables keep their rows | A fixture lecture with a running footer: the footer is absent from every `p*.txt` and present once in `_removed.txt` | 0.3 |
| SN-H3 | The PDF step fails because no Chrome or Edge is installed (fnando/kitabu, simonhaenisch/md-to-pdf) | new action step `preflight` first | New `docs-export` action `check`: looks for `pdftotext` and a browser with the same lookups `ingest` and `browser()` use, and fails with the missing names and an install hint. It runs before `ingest`, so a missing tool costs seconds, not three agent steps | With both lookups pointed at missing paths, the run fails at `preflight` in under 5 s with "no Chrome or Edge found" | 0.3 |
| SN-H4 | An unsourced line survives the rewrite-once rule (yukunou703/studyproof) | new code step `lint` after `check` | `cites.mjs` runs again in lint mode and sets `unsourced` from the file, not from the agent: any line with no `p.N` and no `(unverified)` tag counts. The `signoff` gate summary shows that count | A fixture `notes.md` with one bare line while the agent reports `passed: true`: `lint` reports 1 unsourced line and the `signoff` summary shows it | 0.3 |
| SN-H5 | A failed proof pass leaves `print.css` half edited and the PDF overwritten (AgriciDaniel/claude-obsidian) | `export`, `proof` | `exportPdf` writes to a temp file and renames it over `out/<name>.pdf` only on success, keeping the last good one as `<name>.prev.pdf`. Before `proof` edits, the runner copies `print.css` to `print.css.good`; when the last `proof` reports `passed: false`, the `signoff` summary names both kept files | `exportPdf` with a browser stub that exits 1 (the `chrome` argument exists for this): the earlier PDF's bytes are unchanged | 0.4 |

Worked: 0.25 + 0.3 + 0.3 + 0.3 + 0.4 = 1.55 CC days.
