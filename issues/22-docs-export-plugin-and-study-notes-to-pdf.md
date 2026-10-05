# `docs-export` plugin and `study-notes-to-pdf`

Child #22 of the MetaTrooper epic. Milestone 3. Effort: about 1.5 Claude Code days.

Depends on: child #9, child #15.

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
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
