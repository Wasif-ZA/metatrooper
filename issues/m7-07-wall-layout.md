# M7-7: Wall layout: splitters, fractions, auto layout, drag to pair, fold stack, palette ranking

Part of the MetaTrooper desk epic, Milestone 7 (after the release). Priority: Medium. Effort: 5.0 CC days. Depends on: M7-8, M6-6, M6-7, M6-9, M6-19.

## Source of truth

- `spec.md`: the Milestone 7 children table row M7-7, and the `### M7-7:` section under Milestone 7. D73 and D77 say why it is in this milestone.
- `ide-layer-research/idea-coverage.md` names the mined ideas this child builds.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M7-07a. Dragging a splitter 200 px causes 0 `termResize` calls before release and at most 1 per changed tile after. An arrow key on a focused splitter moves it 2% (plus or minus 0.1%).
- [ ] M7-07b. With `bigFrac` 0.5, adding 3 sessions and removing 2 leaves the big column at 0.5 x (W - 32) px, plus or minus 1 px, before and after a restart.
- [ ] M7-07c. With `ui.layoutAuto` on, going from 1 to 2 to 6 to 9 live sessions with no manual change switches the layout 3 times (pair, big plus two columns, grid); after one Ctrl+G, adding a session switches it 0 times and the crumb reads "manual"; a double-click on the crumb reads "auto" and the next session count change switches the layout again.
- [ ] M7-07d. Dropping a header on the big tile's right 25% pairs it; a centre drop on a side tile swaps the two; Esc leaves the layout unchanged.
- [ ] M7-07e. 20 done sessions on a 900 px tall window: every one has a bar or a row in "+N more", and N equals the count not shown as bars.
- [ ] M7-07f. 10 wheel notches over an unselected tile move its scroll by 0 rows and send 0 bytes to its pty.
- [ ] M7-07g. In the palette, "cdx" ranks "codex ..." first; after one agent is picked 3 times, it ranks above an equal-scoring agent picked 0 times. With a fake clock, an item last used 30 minutes ago scores 4 times its use count, 3 hours ago 2 times, 3 days ago 0.5 times and 30 days ago 0.25 times.
- [ ] M7-07h. With 6 tiles, during a Ctrl+G glide every tile whose size changes by more than 8 px has its live terminal hidden and its snapshot image shown, and `termResize` fires exactly once per changed tile, after the glide ends.
- [ ] M7-07i. Home on a focused splitter puts it back at today's formula. Dragging a working tile's handle to 100 px makes a 36 px bar whose terminal gets no stream; the session entering `waiting_for_you` reopens it within one layout pass.
- [ ] M7-07j. With `ui.newAgent: side`, a session launched by the user or through the public API leaves the big slot unchanged; with `big`, either takes it; with `big-if-idle`, it takes it only when no tile is waiting.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- Nothing here starts before the public release on 2027-01-19.
- No em dashes; comments say what the code does, not why.
