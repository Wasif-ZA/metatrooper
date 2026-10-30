# M7-22: Pipeline products carry-over backlog

Part of the MetaTrooper desk epic (becoming Ouros), Milestone 7. Priority: Low. Effort: not sized. Depends on: spec.md Hand-back item 1.
Status: open; homes undecided.

## Source of truth

- ~/.cache/claude-scratch/metatrooper-m3-2026-10-08/m3-open.md
- ~/.cache/claude-scratch/metatrooper-bugs-2026-10-07/report.html
- status/UI-STATUS.md, M5-STATUS.md, M4-STATUS.md

## What is open

- The pipelines left with the split (D53, M6-1) but their open items were filed nowhere.
- From m3-open.md: 11 built-ins with only fake-engine tests; Gmail pipelines run only against a loopback fake; the desktop plugin sees WinForms controls as Panes (Submit clicks by position); template.list returns 17 templates with no gallery; skipped docs-export Chrome flags and whisper e2e tests; a safe-fetch DNS rebinding gap.
- Also open: the conditional captcha gate (no condition field in the schema) and the Pro pr-review-fix loop never run for real.

## Blocked on

- His Hand-back item 1: GitHub homes for the pipeline products.

## Acceptance criteria

- [ ] M7-22a. One import table (item, source path, owning pipeline, acceptance line) goes into the new repo's first issues once homes are chosen.
- [ ] M7-22b. Items made moot by the split are closed with a one-line reason.
- [ ] M7-22c. spec.md Out of scope links to the table.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for any fix Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
