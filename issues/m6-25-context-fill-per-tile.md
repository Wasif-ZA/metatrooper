# M6-25: Context fill per tile

Part of the MetaTrooper desk epic, Milestone 6. Priority: Medium. Effort: 0.75 CC days. Depends on: M6-20.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-25, and every section that names M6-25. D73 says why it is in this milestone.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-25a. A Claude tile whose last turn used 170,000 of a 200,000-token window shows 85% in orange with "compacts soon"; an engine with no usage shows no context chip.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
