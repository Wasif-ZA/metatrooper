# M6-7: Terminal speed and correctness

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical. Effort: 5.0 CC days. Depends on: none.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-7, and every section that names M6-7.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-07a. Printing a 50 MB file in one tile keeps every other tile's input echo under 100 ms (long-task observer), and the core's memory grows by less than 64 MB during it.
- [ ] M6-07b. With no workbench attached, a fixture program that sends a cursor-position query gets its answer.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
