# M6-26: Limits that carry on: resume at reset, early-end warning, continue in another engine

Part of the MetaTrooper desk epic, Milestone 6. Priority: High. Effort: 2.5 CC days. Depends on: M6-25.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-26, and every section that names M6-26. D73 says why it is in this milestone.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-26a. A limit-hit fixture whose `resets_at` passes (fake clock) gets "Continue where you left off." pasted exactly once; a core restart after that does not paste it again; with the tile's toggle off, nothing is pasted.
- [ ] M6-26b. Six readings 10 minutes apart rising from 40% to 90%, with the reset 2 h after the last one, raise one early-end item naming a time 10 minutes after the last reading. Worked: slope = (90 - 40) / 50 minutes = 1 point per minute; (100 - 90) / 1 = 10 minutes, which is before the reset, so the item fires.
- [ ] M6-26c. "Continue in Codex" writes a handoff file of at most 6 KB holding the task line and changed files, and a Codex session starts with it as the prompt.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
