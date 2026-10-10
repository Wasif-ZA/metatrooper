# M6-23: Comments that come back: threads, replies, source file, mark-up, cross-origin picks

Part of the MetaTrooper desk epic, Milestone 6. Priority: High. Effort: 6.0 CC days. Depends on: M6-3, M6-11, M6-13.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-23, and every section that names M6-23. D73 says why it is in this milestone.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-23a. An agent calls `comments`, gets the user's open note, replies and resolves it; the pane's pin turns green and shows the reply, and the row reads resolved.
- [ ] M6-23b. A pick on a fixture React app served from an owned dev port names `<PricingCard>` and its `file:line`; the same app on a non-owned origin gets no stub (no `__REACT_DEVTOOLS_GLOBAL_HOOK__` defined by MetaTrooper) and no source line.
- [ ] M6-23c. A pick inside a cross-origin iframe returns that element, a crop of it, and the frame URL.
- [ ] M6-23d. A mark-up with an arrow and a box saves one PNG under 2 MB into the comment row.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
