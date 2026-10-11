# M7-2: Comments that come back: threads, source file of a pick, mark-up, cross-origin picks

Part of the MetaTrooper desk epic, Milestone 7 (after the release). Priority: High. Effort: 6.0 CC days. Depends on: M7-1, M6-13, M6-18.

## Source of truth

- `spec.md`: the Milestone 7 children table row M7-2, and the "Specced, built after the release" section, which names this child. D73 and D77 say why it is in this milestone.
- `ide-layer-research/idea-coverage.md` names the mined ideas this child builds.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M7-02a. An agent calls `comments`, gets the user's open note, replies and resolves it; the pane's pin turns green and shows the reply, and the row reads resolved.
- [ ] M7-02b. A pick on a fixture React app served from an owned dev port names `<PricingCard>` and its `file:line`; the same app on a non-owned origin gets no stub (no `__REACT_DEVTOOLS_GLOBAL_HOOK__` defined by MetaTrooper) and no source line.
- [ ] M7-02c. A pick inside a cross-origin iframe returns that element, a crop of it, and the frame URL.
- [ ] M7-02d. A mark-up with an arrow and a box saves one PNG under 2 MB into the comment row.
- [ ] M7-02e. `reveal {ref}` flashes the session's cursor on that element. Three picks made before one prompt reach the agent as one batch. A reply holding a fixture secret value is stored redacted. A mark-up keeps its shapes as JSON in the comment row, and a 5 MP capture is refused at the 4 MP cap.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- Nothing here starts before the public release on 2027-01-19.
- No em dashes; comments say what the code does, not why.
