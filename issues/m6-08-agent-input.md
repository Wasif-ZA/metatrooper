# M6-8: Agent input: Shift+Enter, image paste, links

Part of the MetaTrooper desk epic, Milestone 6. Priority: High. Effort: 1.5 CC days. Depends on: M6-7.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-8, and every section that names M6-8.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-08a. Shift+Enter in a Claude, Codex and Gemini tile inserts a newline and does not submit, checked on each live CLI.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
