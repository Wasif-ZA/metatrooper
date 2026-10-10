# M6-24: Compare the page: device, rendering, reference overlay, follow session

Part of the MetaTrooper desk epic, Milestone 6. Priority: High. Effort: 2.0 CC days. Depends on: M6-11.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-24, and every section that names M6-24. D73 says why it is in this milestone.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-24a. Device iPhone preset, then a navigation: the page still reports `innerWidth` 390. `emulate {color_scheme: "dark"}` makes `matchMedia('(prefers-color-scheme: dark)')` true on the next snapshot.
- [ ] M6-24b. With Follow session on, a session moving from `working` to `done` reloads its shown pane once.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
