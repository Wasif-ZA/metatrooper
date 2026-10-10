# M6-12: Browser handoff, origins, secrets, audit

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical. Effort: 3.5 CC days. Depends on: M6-2, M6-11.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-12, and every section that names M6-12.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-12a. `handoff` makes every other browser tool fail with "the user has the pane" until Give back.
- [ ] M6-12b. `type` with `{{secret:NAME}}` into a password field on the saved origin fills it; on another origin or a plain field it fails; the value appears in no `event` row, log, tool result, approval row or crop (marker test as M1-05).

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
