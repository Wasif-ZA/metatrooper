# M7-6: Sessions: Gemini usage, pi state, exit ladder, prompt check, turn refs, quiet phone alerts, worktree files

Part of the MetaTrooper desk epic, Milestone 7 (after the release). Priority: High. Effort: 2.5 CC days. Depends on: M6-5, M6-10, M6-20, M6-21.

## Source of truth

- `spec.md`: the Milestone 7 children table row M7-6, and the `### M7-6:` section under Milestone 7. D73 and D77 say why it is in this milestone.
- `ide-layer-research/idea-coverage.md` names the mined ideas this child builds.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M7-06a. A 3-turn fixture Gemini transcript gives `usage` rows whose tokens sum to the transcript's, and M6-20's chip shows them.
- [ ] M7-06b. `closeGracefully()` passes a fake-clock table for all five steps. A session in `waiting_for_you` is killed with nothing typed. Killing a fixture session that started a node server leaves 0 processes carrying its `TROOP_SESSION_ID` 3 s after the kill step.
- [ ] M7-06c. A fixture engine that ignores input raises 1 "may not have been sent" item at 20 s (fake clock); one that goes `working` at 5 s raises 0. Resend pastes the prompt once more. A prompt due while the user typed into the tile 1 s ago is written 2 s after that keystroke, not before.
- [ ] M7-06d. In a fixture repo with an untracked file holding "a" before the turn, a turn that changes it to "b" leaves "a" in the turn ref's tree and shows a one-line change in the Diff; after `git gc --prune=now` the ref still resolves; the index file's hash is unchanged; hiding the session leaves the ref in place.
- [ ] M7-06e. With idle at 0 s, an open row is not sent at 60 s and is sent at 300 s; with idle at 200 s it is sent on the next tick; with no idle report for 90 s it is sent at once; 3 rows in 5 s on one session send 1. With the window hidden and a row open, `flashFrame(true)` is called and the taskbar overlay shows the open count.
- [ ] M7-06f. `preserve: [".env*"]` copies `.env.local`; `../x`, `C:\x`, `\\h\s` and an empty pattern are refused; a symlink out of the repo is refused; the core heartbeat ticks at least every 2 s during a slow fixture checkout.
- [ ] M7-06g. A pi session shows `working`, `waiting_for_you` on a permission ask and `idle` from its plugin, not its title.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for this child (D65), with a mutation run that must fail at least one test.
- Nothing here starts before the public release on 2027-01-19.
- No em dashes; comments say what the code does, not why.
