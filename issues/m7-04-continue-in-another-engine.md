# M7-4: Continue in another engine

Part of the MetaTrooper desk epic, Milestone 7 (after the release). Priority: Medium. Effort: 1.5 CC days. Depends on: M6-24.

## Source of truth

- `spec.md`: the Milestone 7 children table row M7-4, and the "Specced, built after the release" section, which names this child. D73 and D77 say why it is in this milestone.
- `ide-layer-research/idea-coverage.md` names the mined ideas this child builds.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M7-04a. A limit-stopped fixture tile's "Continue in codex" writes a handoff file of at most 6 KB holding the task line and the last 10 turns, and launches codex with it as the prompt.
- [ ] M7-04b. The handoff file also lists the session's changed files and its last failing command; when the last 10 turns hold 1 KB each, the oldest are dropped first until the file fits 6 KB. A limit stop never switches engine without the click.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- Nothing here starts before the public release on 2027-01-19.
- No em dashes; comments say what the code does, not why.
