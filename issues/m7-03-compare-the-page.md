# M7-3: Compare the page: device, rendering, reference overlay, follow session

Part of the MetaTrooper desk epic, Milestone 7 (after the release). Priority: Medium. Effort: 2.0 CC days. Depends on: M6-11.

## Source of truth

- `spec.md`: the Milestone 7 children table row M7-3, and the "Specced, built after the release" section, which names this child. D73 and D77 say why it is in this milestone.
- `ide-layer-research/idea-coverage.md` names the mined ideas this child builds.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M7-03a. Device iPhone preset, then a navigation: the page still reports `innerWidth` 390. `emulate {color_scheme: "dark"}` makes `matchMedia('(prefers-color-scheme: dark)')` true on the next snapshot.
- [ ] M7-03b. With Follow session on, a session moving from `working` to `done` reloads its shown pane once.
- [ ] M7-03c. Overlay reference over a fixture page: the divider and opacity slider change only the overlay, it follows a 500 px scroll within 1 frame, and a DOM mutation observer on the page records 0 changes. After DevTools detaches, the pane's device and rendering record is re-applied. With Follow session on, `working` to `idle` also reloads once.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- Nothing here starts before the public release on 2027-01-19.
- No em dashes; comments say what the code does, not why.
