# Variants grid

Child #8 of the MetaTrooper epic. Milestone 2. Effort: about 2 Claude Code days.

Depends on: child #4, child #6.

## What

Variants grid: tiles, pick, combine, discard

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Background. The run folds to the 36px wall bar with three small live thumbnails, A, B and C.

- Layouts: variants-grid, artifact-columns (canvas), preview-stage (A / B / C stage), agent-split (worktree rail),
  artifact-columns (direction lanes). Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens when `approve-directions` or `pick` starts waiting, a variant or `polish` fails, or a variant's port never
  answers.
- Pick, first match: a failure goes to agent-split on that worktree with its terminal output; `approve-directions`
  to artifact-columns (direction lanes); `pick` to variants-grid. Opened by hand: canvas during `board` or
  `directions`, variants-grid during `variants`, preview-stage during or after `polish`.
- Steps: as in `pipelines/design-variants.json`.

## Acceptance criteria

- [ ] M2-03. Variants: Pick shows that worktree's diff in the tray; Combine starts a new worktree with the note and crops; Discard removes the worktree.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
