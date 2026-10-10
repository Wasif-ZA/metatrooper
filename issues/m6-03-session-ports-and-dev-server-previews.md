# M6-3: Session ports and dev-server previews

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical. Effort: 1.5 CC days. Depends on: M6-1, M6-4.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-3, and every section that names M6-3.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-03a. A fixture dev server started in a session's terminal prints its URL; within 2 s a `session_dev_server` row with `matched_by: ancestry` exists, the tile shows "Open preview", and that session's agent pane loads it.
- [ ] M6-03b. A fixture `npm run dev` that starts a detached child gets a `printed` row and the same result. A port served by a process started outside MetaTrooper before the URL was printed is blocked for agent panes.
- [ ] M6-03c. A user pane loads `http://localhost:<any listening port>` typed by hand; no agent tool can drive that pane.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
