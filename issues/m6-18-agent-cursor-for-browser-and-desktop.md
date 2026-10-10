# M6-18: Agent cursor for browser and desktop

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical. Effort: 4.5 CC days. Depends on: M6-11, M6-15.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-18, and every section that names M6-18.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-18a. In a browser pane and in Notepad, every click and type shows the session's own cursor arriving at the target before the input lands, measured from the overlay's `arrived` message and the input time; the added time per action is under 250 ms at the 95th percentile over 100 actions.
- [ ] M6-18b. Two agents acting at once show two cursors in their own colours. The real pointer's position is unchanged throughout (read before and after).
- [ ] M6-18c. An agent screenshot taken while its cursor is visible does not show the cursor (pixel check at the cursor's position), or the result carries `overlay_may_show: true`.
- [ ] M6-18d. On two displays at 100% and 150%, the cursor lands within 3 px of the target after the target window is dragged from one display to the other.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
