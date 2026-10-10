# M6-15: Computer use: `metatrooper-desktop`, grants, frame, take-over, watch layout

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical. Effort: 10.0 CC days. Depends on: M6-2, M6-14.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-15, and every section that names M6-15.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-15a. A session granted Notepad types into it while another app has focus, and the pointer does not move. The same session acting on Calculator (not granted) gets "window not granted". Notepad's Save As dialog is reachable and every input in it raises an approval.
- [ ] M6-15b. Ctrl+Alt+Q while an agent types a 2,000-character string: after the core acknowledges the pause, no further character reaches Notepad (checked by comparing the file text at the acknowledgement and 2 s later).
- [ ] M6-15c. The workbench window never appears in `windows`, and a direct call naming its handle fails. Closing a granted window ends its grant; a new window that gets the same handle is not granted. After a core restart, no grant is live.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
