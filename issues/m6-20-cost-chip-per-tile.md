# M6-20: Cost chip per tile

Part of the MetaTrooper desk epic, Milestone 6. Priority: Medium. Effort: 0.5 CC days. Depends on: none.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-20, and every section that names M6-20.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-20a. A Claude tile's cost chip equals the session's tokens in `usage`; an engine with no usage shows "usage unknown".

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
