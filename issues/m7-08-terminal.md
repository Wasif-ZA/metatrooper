# M7-8: Terminal: paste, shell marks, batching, OSC text, resize, copy output, graphemes, find, screen reader, anchor

Part of the MetaTrooper desk epic, Milestone 7 (after the release). Priority: Medium. Effort: 3.5 CC days. Depends on: M6-7, M6-8, M6-19.

## Source of truth

- `spec.md`: the Milestone 7 children table row M7-8, and the `### M7-8:` section under Milestone 7. D73 and D77 say why it is in this milestone.
- `ide-layer-research/idea-coverage.md` names the mined ideas this child builds.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M7-08a. Pasting 20 lines into a Claude tile submits 0 times, and the input holds all 20 lines. Into a fixture agent that never turns bracketed paste on, the bytes still start with `ESC[200~`; into a shell tile with the mode off, they do not.
- [ ] M7-08b. With `shell_integration` on, in pwsh (`cmd /c exit 3`) and Git Bash (`(exit 3)`) the tile header shows "exit 3" and the right cwd in the tile header within 500 ms; a printed mark with a wrong nonce changes nothing.
- [ ] M7-08c. Echo p95 from `termView.timeEcho` is at most the idle p95 plus 2 ms, and while a 50 MB file prints, IPC messages per second drop at least 5 times against the unbatched build.
- [ ] M7-08d. A fixture prints `ESC]9;approval needed: rm x` ended by BEL, then a plain BEL: the needs-you item the bell raises shows "approval needed: rm x" within 1 s. The OSC alone raises no item. 100 such marks in 1 s make at most 5 updates.
- [ ] M7-08e. In a 600 ms drag-resize, the first `termResize` comes within 16 ms of the first observer event, there are at most 13 in all, and the last equals the final fit.
- [ ] M7-08f. After `seq 1 1000` in a shell tile, Copy output gives exactly 300 lines (1 to 60 and 761 to 1000). Worked: 60 head lines + 240 tail lines = 300; the tail starts at 1000 - 240 + 1 = 761. 100 lines of 500 characters (50,000) give a head of 4,800 characters and a total of at most 24,000. Send to tile pastes the same text into the chosen tile.
- [ ] M7-08g. 20 fixture strings each end at the column listed for them in the fixture (`|👍🏽👨‍👩‍👧中文|` closes at column 10: 1 + 2 + 2 + 2 + 2 + 1), in the renderer and in the headless snapshot. With the unicode11 fallback, the fixture's ZWJ rows carry their own expected columns.
- [ ] M7-08h. Ctrl+F for a marker printed 3 times in 10,000 lines of scrollback shows "1 of 3" within 200 ms; Enter visits all 3.
- [ ] M7-08i. With `screen_reader` on, only the selected tile's xterm has `screenReaderMode` on (every tile keeps its `aria-label`), the live line speaks at most once per 500 ms and at most 4,000 characters, and Escape then Tab moves focus out of the terminal.
- [ ] M7-08j. The repaint replay result is in the issue; if the fix was built, 10 replays end at the bottom 10 times, and a replay started with the user scrolled up 50 rows leaves the view where it was.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- Nothing here starts before the public release on 2027-01-19.
- No em dashes; comments say what the code does, not why.
