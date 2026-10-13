# M7-8: Terminal: paste, shell marks, batching, OSC text, resize, copy output, graphemes, find, screen reader, anchor

Part of the MetaTrooper desk epic, Milestone 7 (after the release). Priority: Medium. Effort: 3.5 CC days. Depends on: M6-7, M6-8, M6-19 (all merged). Start from `main` after the public release on 2027-01-19; record that `main` SHA as the base in the report.

## Source of truth

- `spec.md`: the Milestone 7 children table row M7-8, and the `### M7-8:` section under Milestone 7. D73 and D77 say why it is in this milestone.
- `ide-layer-research/idea-coverage.md` names the mined ideas this child builds: wall-terminal 7, 8, 10, 11, 12, 13, 14, 15, 16 and 18.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Context

Ten repairs to how a tile behaves as a terminal. Each one fixes something a user hits in the first hour: a pasted multi-line prompt submits early, a shell tile cannot say whether its last command failed, a fast printer floods IPC, a desktop notification an agent prints is lost, a resize lags, emoji break columns, and there is no find, no copy of a command's output and no screen reader support.

## Current state (verified 2026-10-14 on `main` 4fb7ef9; find code by the quoted text, line numbers move)

| # | Fact | Where |
|---|---|---|
| 1 | A renderer paste never reaches the core's `paste()`. `paste` reads the clipboard and calls xterm's own `term.paste(s)`, which brackets from the renderer xterm's mode, then `onData` sends it as `termInput`, pipe op `input`. The core's `paste()` brackets only when `t.head.modes.bracketedPasteMode` is on, and is called only by the core (prompt delivery, `session.paste-prompt`, limit resume). | `workbench/renderer/terminal.js` `const paste`; `core/src/terminal/index.ts` `paste`, `bracketedPaste` |
| 2 | Shift+Enter (M6-8) sends `ESC CR` or a bracketed newline per the engine's `shift_enter`, skipped on shell tiles. | `terminal.js` key handler; `core/src/engines/registry.ts` `shift_enter` |
| 3 | No shell integration: no `core/resources/`, no OSC handler on the headless terminal, no `term.cmd` event, no `terminal.shell_integration`. Default shells: `pwsh.exe -NoLogo` (fallback `powershell.exe -NoLogo`) and Git Bash `bash.exe --login -i`. A shell tile header shows its label, its start cwd and idle or exited. | `core/src/terminal/shells.ts`; `core/src/settings.ts` `terminal.shells`; `workbench/renderer/app.js` `shellRows` |
| 4 | Output goes to each viewer per pty chunk, split at `terminal.chunk_bytes` (64 KB), inside the M6-7 credit (`CREDIT_BYTES` 64 KB, `held`, `pump`, op `ack`). Over `HOLD_BYTES` (1 MB) held, the viewer is detached and marked stale. `exit` already flushes `held` first. `terminal.slow_viewer_bytes` (4 MB) is read nowhere. | `core/src/terminal/pipe.ts` |
| 5 | No OSC 9 or 777 handling. A bell appends `term.bell` (unless silenced), and the state moves to `waiting_for_you`; no `needs_you` row is written, and the renderer lists the session as waiting. The last line and title live in memory in `live` and reach the wall through `liveText()`. | `core/src/terminal/events.ts` `wireTermEvents`; `core/src/events/state.ts`; `app.js` `waitingAll` |
| 6 | Resize is a 150 ms trailing timer: `new ResizeObserver(() => { clearTimeout(t.fitTimer); if (!t.attached) resize(t); else t.fitTimer = setTimeout(() => resize(t), 150); })`. `resize(t)` fits and sends `termResize` only when cols or rows changed. | `terminal.js` (about line 106; spec.md's `:55` is stale) |
| 7 | Right-click on a tile pastes (`contextmenu` calls `paste()`); right mouse down and up never reach the program. No `zones.ts`, no Copy output, no Send to tile. | `terminal.js` |
| 8 | Packages: workbench `@xterm/xterm` 6.0.0 and `@xterm/addon-fit` 0.11.0; core `@xterm/headless` 6.0.0 and `@xterm/addon-serialize` 0.14.0. No unicode, graphemes or search addon; `unicode.activeVersion` is never set. | `workbench/package.json`, `core/package.json`, `workbench/renderer/index.html` |
| 9 | Ctrl+F in a terminal tile goes to the program as `^F`; the Ctrl+F handler in `app.js` is in `browserKeys()` only. Search across tiles (M6-19) is `session.search` from the Ctrl+K palette, revealed by `termView.reveal()`. | `terminal.js` key handler; `app.js` `browserKeys`; `core/src/terminal/index.ts` `search` |
| 10 | No `screenReaderMode`, no `aria-label` on tiles; the only live region is `#toasts`. | `index.html` |
| 11 | No CSI handler, no handling of `ESC[3J` or mode 2026, and no recorded Claude repaint fixture. | repo-wide |
| 12 | `termView.timeEcho` exists and `ui-revision.test.ts` uses it. Nothing counts IPC messages. | `terminal.js` |
| 13 | `terminal` settings: `cols`, `rows`, `scrollback`, `font_size`, `chunk_bytes`, `slow_viewer_bytes`, `bell_silent_ms`, `prompt_wait_ms`, `last_line_every_ms`, `last_line_chars`, `git_every_ms`, `shells`. | `core/src/settings.ts` |

## Change

1. **Multi-line paste** (wall-terminal 7). In an agent tile (not `.shell`), a paste whose text holds a newline is sent as `ESC[200~` + text with `\r?\n` turned into `\r` + `ESC[201~` through the existing `termInput`, not through `term.paste`. Shell tiles keep `term.paste`. The core's `paste()` gets the same rule for agent sessions (any session that is not a shell), so a multi-line prompt from `writePrompt`, `session.paste-prompt` or limit resume is bracketed even when ConPTY hides the mode. No new pipe op or preload method. Shift+Enter is unchanged.
2. **Shell marks** (wall-terminal 8).
   - New `core/resources/shell/pwsh.ps1` and `bash.sh`, about 40 lines each. They emit OSC 133 `A` (prompt start), `B` (input start), `C` (command start) and `D;<exit>` (command end), each ending `;nonce=<TROOP_SHELL_NONCE>`, and OSC 7 with the cwd as a `file://` URL after each command.
   - `shells.ts` adds them only when `terminal.shell_integration` is true (default false) and the shell's argv equals its default. pwsh: `pwsh.exe -NoLogo -NoExit -Command ". '<pwsh.ps1>'"` (the profile still loads). Bash: `bash.exe --init-file <bash.sh> -i`; `bash.sh` first sources `/etc/profile`, then the first of `~/.bash_profile`, `~/.bash_login`, `~/.profile` that exists, as a login shell would. `TROOP_SHELL_NONCE` is 16 random hex characters per session, set in the shell's env only.
   - `open()` registers OSC 133 and OSC 7 handlers on the headless terminal. A mark with a wrong or missing nonce is ignored. Valid marks append `term.cmd {phase: 'running' | 'idle', exit, cwd}`, at most one event per command phase. `contracts/events-and-hooks.md` names the kind.
   - `shell.list` returns the latest `phase`, `exit` and `cwd`. The shell tile header shows "running" or "idle", "exit N" when N is not 0, and the cwd from OSC 7.
3. **Output batching** (wall-terminal 10). `pipe.ts` keeps one buffer per viewer, in front of the credit. The first chunk after 8 ms of quiet goes at once. The rest of a burst is sent every `terminal.batch_ms` (new, 8), or as soon as the buffer reaches `terminal.chunk_bytes` (64 KB). `exit`, `snapshot` and detach flush the buffer first. Batches pass through the credit unchanged, so `HOLD_BYTES` still applies. (spec.md says "at 4 MB it flushes"; 4 MB is above the 1 MB hold limit and would detach every viewer, so the cap is `chunk_bytes`.)
4. **OSC text** (wall-terminal 11). OSC 9 (`ESC]9;<text>`) and OSC 777 (`ESC]777;notify;<title>;<body>`, shown as "title: body") handlers on the headless terminal. OSC 9 with a numeric subcommand (`9;4;...`, Windows Terminal progress, and any `9;<digits>;`) is ignored. Control characters are removed, the text is cut to 200 characters, and at most 5 updates per second per session are kept. The text is held in `live` as `note` beside `line` and `title`, reaches the wall through `liveText()`, and shows on that session's waiting row in the sheet and on its tile while it waits. The bell stays the trigger: OSC text alone changes no state.
5. **Resize on the leading edge** (wall-terminal 12). The 150 ms trailing timer becomes a leading-and-trailing helper: fit and resize on the first observer event, then at most once per 50 ms, and once more 50 ms after the last event so the final size is always sent. M7-7's wall glide suppresses observer events during a glide; this helper applies to window and splitter resizes.
6. **Copy output** (wall-terminal 13).
   - New `core/src/terminal/zones.ts` keeps, per shell session, the last 50 commands as headless-terminal markers at `C` and `D` (needs Change 2). A command whose start marker was trimmed from scrollback keeps what remains and says "start of output scrolled out".
   - New UI method `shell.output {id, n}` returns the text of command n from the end (default the last), cut by the rule: output over 300 lines or 24,000 characters keeps a head (the first 60 lines, at most 4,800 characters) and fills the rest with the tail, up to 300 lines and 24,000 characters in all, with one "... N lines cut ..." line between.
   - Right-click opens a menu when there is a selection (Copy, Send to tile) or on a shell tile (Paste, Copy output, Send output to tile; output items greyed without shell marks). Send to tile lists the other tiles and pastes into the chosen one through `session.paste-prompt` (bracketed by Change 1). Right-click with no selection on an agent tile still pastes, as today.
7. **Graphemes** (wall-terminal 14). First check: `@xterm/addon-unicode-graphemes` loads under `@xterm/headless` 6.0.0 in a node test. If it does, it loads on both the renderer and the headless terminal with the same `unicode.activeVersion`; if not, `@xterm/addon-unicode11` on both, and the result goes in the issue. Both packages sit under the existing @xterm exception in Dependencies (MIT, the `xtermjs/xterm.js` repo); versions are pinned to ones released for xterm 6.0.0.
8. **Find in a tile** (wall-terminal 15). `@xterm/addon-search` (same exception) on the renderer. Ctrl+F in the selected tile opens a find box in its header with an "n of m" count; Enter and Shift+Enter go to the next and previous hit; Esc closes it. While the program is in the alternate screen (`term.buffer.active.type === 'alternate'`, for example `less` or `vim`), Ctrl+F goes to the program as today. Search across tiles stays M6-19's.
9. **Screen reader** (wall-terminal 16). `terminal.screen_reader`, default false. When on: `screenReaderMode` on the selected tile's xterm only, moved on selection change; every tile gets `aria-label` "<engine>, <state words>" (for example "claude, waiting for you") whatever the setting; one new polite live region announces needs-you changes, at most once per 500 ms and cut at 4,000 characters; Escape followed by Tab within 1 s moves focus to the next control outside the terminal. The Escape still reaches the program.
10. **Viewport anchor** (wall-terminal 18). First, record one Claude Code repaint (the bytes of a turn that redraws with `ESC[3J` inside a mode 2026 block) into `workbench/test/fixtures/claude-repaint.bin`, and replay it into a tile 10 times. If the tile ends at the bottom all 10 times, nothing is built and the result (Claude Code version, 10 of 10) goes in this issue. If not: a CSI handler notes `ESC[3J` inside a mode 2026 block and scrolls to the bottom 20 ms after the block ends, only when the view was at the bottom when the block began.
11. **IPC probe for c.** With `METATROOPER_WORKBENCH_PROBE` set, the workbench main process logs the count of `termData` IPC messages per second per tile.

## Acceptance criteria

The first ten are copied from `spec.md` and must not be reworded here.

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
- [ ] M7-08k. A 3-line prompt delivered by `writePrompt` to a fixture agent with bracketed paste off arrives bracketed, with `\r` line ends, and is submitted once by the trailing `\r`.
- [ ] M7-08l. With `shell_integration` off (the default), the pwsh and bash argv are byte for byte today's, and no `TROOP_SHELL_NONCE` is set. A user-edited shell argv gets no script even with it on.
- [ ] M7-08m. `ESC]9;4;1;50` ends with no note and no update; `ESC]777;notify;Build;done` gives the note "Build: done"; a note with a control character and 300 characters is stored clean and at 200.
- [ ] M7-08n. Batching: a single 10-byte chunk after 20 ms of quiet reaches the viewer within 2 ms of being read; a 1 MB burst never leaves more than `chunk_bytes` in the batch buffer; `exit` arrives after every byte before it.
- [ ] M7-08o. Right-click with no selection on an agent tile pastes and opens no menu; on a shell tile it opens the menu, and Paste in it pastes.
- [ ] M7-08p. In `less` (alternate screen) in a shell tile, Ctrl+F reaches the program as `^F` and opens no find box.
- [ ] M7-08q. Each test states its card: `protects=`, `fails_when=`, `no_claim=`.
- [ ] M7-08r. The existing workbench and core suites still pass; `ui-revision.test.ts` echo checks are unchanged.

## Testing plan

D65 does not list M7-8, so the implementing agent writes the tests, with the cards in rule 1.

| Layer | What | Count |
|---|---|---|
| Core unit | f and the cut rule, m, n, the nonce check in b | +4 |
| Core with a pty | a and k (fixture agent, mode off), b (pwsh and Git Bash, skipped where the shell is missing), d, l | +5 |
| Renderer unit | e (fake observer and clock), g (20-string fixture, both terminals), o, p | +4 |
| Electron | c (echo p95 and the IPC probe, 50 MB), h, i, j (repaint replay) | +4 |

## Rules for the implementing agent

1. Acceptance criteria are the `protects / fails_when / no_claim` profile of each test: never "make the tests pass".
2. Real code and real tests land in the same change.
3. Any change to an existing test, timeout or threshold is reported on its own line first, with its reason.
4. A reported command names the command and its observed result; stderr is never silenced in a cited command.
5. Your report is a claim until the parent re-runs it.
6. Never commit, push or open PRs; hand back the command. No em dashes; comments say what the code does.
7. Nothing here starts before the public release on 2027-01-19. Add packages with exact versions; no other new dependency.

## Rollback

Revert the merge. `term.cmd` events and the new settings are additive and ignored by older code. `shell_integration` and `screen_reader` are off by default, so turning them off undoes their part without a revert.

## Effort

0.75 shell marks (two scripts, argv, handlers, `term.cmd`, header), 0.75 copy output (`zones.ts`, cut rule, `shell.output`, menu, Send to tile), 0.25 paste, 0.25 batching and the IPC probe, 0.25 OSC text, 0.25 resize, 0.25 graphemes and its first check, 0.25 find, 0.25 screen reader, 0.25 repaint recording and replay = 3.5 CC days, tests inside each part.

## Files

| File | Change |
|---|---|
| `core/resources/shell/pwsh.ps1`, `core/resources/shell/bash.sh` | new |
| `core/src/terminal/shells.ts` | argv with the scripts, `TROOP_SHELL_NONCE` |
| `core/src/terminal/index.ts` | `paste()` rule for agents; OSC 133, 7, 9, 777 handlers; graphemes on the headless terminal |
| `core/src/terminal/events.ts` | `note` in `live`; `term.cmd` events |
| `core/src/terminal/zones.ts` | new |
| `core/src/terminal/pipe.ts` | per-viewer batch buffer |
| `core/src/methods.ts` | `shell.list` fields, `shell.output` |
| `core/src/settings.ts` | `terminal.batch_ms`, `terminal.shell_integration`, `terminal.screen_reader` |
| `core/package.json`, `workbench/package.json` | the unicode addon; `@xterm/addon-search` on the workbench |
| `workbench/renderer/terminal.js` | paste path, resize helper, right-click menu, find box, screen reader, CSI handler if built |
| `workbench/renderer/app.js`, `index.html`, `wall.css` | shell header fields, note on waiting rows, live region, tile `aria-label` |
| `workbench/src/main.ts`, `workbench/src/preload.cjs` | `shell.output` in `UI_METHODS`; the IPC probe |
| `contracts/events-and-hooks.md`, `contracts/pipe-protocol.md` | `term.cmd`, `shell.output` |
| `core/test/`, `workbench/test/` | the tests above and `claude-repaint.bin` |

## Out of scope

- Shell marks for cmd.exe, WSL or a user-edited shell argv.
- Copy output for agent tiles (they print no command marks).
- Search across tiles (M6-19) and a regex search mode.
- Using `terminal.slow_viewer_bytes`, which nothing reads today (listed in the report).
