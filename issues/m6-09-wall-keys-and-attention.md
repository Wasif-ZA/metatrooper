# M6-9: Wall keys and attention

Part of the MetaTrooper desk epic, Milestone 6. Priority: High. Effort: 2.0 CC days. Depends on: M6-1, M6-5.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-9, and every section that names M6-9.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-09a. Alt+J focuses the session with the smallest `since`. A key press in the big tile, then a second session starts waiting: the big slot stays unchanged for 3 s, then the waiting tile glides in.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
