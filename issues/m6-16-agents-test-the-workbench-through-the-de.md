# M6-16: Agents test the workbench through the desktop tools

Part of the MetaTrooper desk epic, Milestone 6. Priority: Medium. Effort: 1.5 CC days. Depends on: M6-15, M6-18.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-16, and every section that names M6-16.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-16a. An agent drives a `--demo` workbench: opens a tile, approves a card, reads the "Open preview" chip; no screenshot shows a real session, and the demo core cannot see the real database.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
