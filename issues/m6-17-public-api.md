# M6-17: Public API: one method list, exact shapes, `session.wait`

Part of the MetaTrooper desk epic, Milestone 6. Priority: High. Effort: 2.0 CC days. Depends on: M6-1.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-17, and every section that names M6-17.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-17a. The generated method table, `troop --help` and the skill list the same methods as `methods.ts`; a test fails when one is edited by hand.
- [ ] M6-17b. `session.wait` returns within 1 s of the state change, at once when already in the state, at the timeout when it never comes, and -32602 for an empty `states` or a `timeout_ms` of 0.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
