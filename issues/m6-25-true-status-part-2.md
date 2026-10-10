# M6-25: True status, part 2: background work, StopFailure, interrupts, fatal patterns, opencode

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical. Effort: 2.25 CC days. Depends on: M6-5.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-25, and every section that names M6-25. D73 says why it is in this milestone.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-25a. A Claude `Stop` fixture with a running `subagent` background task leaves the session `working`; 10 minutes with no event (fake clock) moves it to `done`.
- [ ] M6-25b. A `claude.StopFailure` fixture shows `waiting_for_you` with reason `stopped: rate_limit`.
- [ ] M6-25c. Escape in a working fixture session whose title then matches the idle pattern within 5 s gives `idle` and one `core.interrupted` event.
- [ ] M6-25d. A fixture engine printing a `fatal_patterns` string and then nothing for 60 s raises one needs-you item naming the pattern; no screen text is stored in it.
- [ ] M6-25e. An opencode session shows `working` and `done` from its plugin, not from its title.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
