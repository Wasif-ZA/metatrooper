# M8-38: Desktop driver upgrades: read Electron apps, faster snapshots, honest refusals

Part of Ouros, Milestone 8. Priority: High. Effort: 9.5 CC days. Depends on: none (extends M6-15).
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section "Computer use and browser use (2026-11-02)".
- `contracts/desktop-tools.md`. If this file and the contract disagree, the contract wins until this child changes it.
- Research: scratch `ouros-computer-use-2026-11-02/REPORT.html`, lane replies in `lanes/`.

## What it does

Keeps the built-in UI Automation driver (D71, D78) and fixes its measured gaps with mechanisms read in other drivers.
Nothing is linked and nothing is installed. Each row below is rebuilt in `core/src/desktop/uia-helper.ps1`, not copied.

## Code to pull

Measure first (row 1). Rows 2 and 3 keep a change only if row 1 shows it helps.

| # | Change | Read it at | Licence | Days |
|---|---|---|---|---|
| 1 | Fixture benchmark: fresh target app, a sentinel watching pointer and focus, success judged from the fixture's own state, WinForms and Electron fixtures | stablyai/orca `b29e7f5` `config/benchmarks/computer-use/` (`trial_contract.py`, `sentinel.py`, `fixture_win.ps1`, `electron/main.js`) | MIT | 3 |
| 2 | Read Electron and Chromium pages: find `Chrome_RenderWidgetHostHWND` children, touch each through `AutomationElement.FromHandle`, poll until the page root has children, re-resolve the root on every probe | Yu-tao-Li/dsh-computer-use-win `6fb6421` `scripts/windows-uia.ps1#L254-L275`, `#L2405-L2445` | MIT | 1 |
| 3 | One-call snapshot: a cache request plus `FindAllBuildCache(TreeScope_Subtree)` replaces the per-node `TreeWalker.ControlViewWalker` walk at `uia-helper.ps1:250` | xa11y/xa11y `95465ec` `xa11y-windows/src/uia.rs#L170-L180`, `#L596-L606` | MIT | 2 |
| 4 | Skip wrapper nodes on Chromium windows only (class `Chrome_WidgetWin_1`), so `max_nodes` reaches real content | vercel-labs/agent-desktop `9eb9b29` `crates/windows/src/tree/chromium.rs`, `CONCEPTS.md` "Web Wrapper" | Apache-2.0 | 0.5 |
| 5 | Refuse instead of dropping: a table of window class and event kind that posted messages lose, returning `background_unavailable` with the remedy | trycua/cua `0cdcec9` `libs/cua-driver/rust/crates/platform-windows/src/input/delivery.rs` (`would_be_silently_dropped`, L101) | MIT | 1 |
| 6 | Report and return the foreground after a pattern call steals it, and flag pointer drift | dsh-computer-use-win `6fb6421` `scripts/windows-uia.ps1#L350-L395`, `#L871-L895` | MIT | 1 |
| 7 | List each node's actions (Invoke, Toggle, Select, SetValue) in the snapshot | stablyai/orca `b29e7f5` `native/computer-use-windows/runtime.ps1#L436-L445`, `#L919-L970` | MIT | 0.5 |
| 8 | Mark a capped snapshot as truncated | CursorTouch/Windows-MCP `94b52cf` `src/windows_mcp/tree/budget.py` | MIT | 0.5 |

## Not pulled

- Real-input paths in Windows-MCP, UFO, Orca's coordinate clicks and terminator's `click()`: they break D78.
- Physical-input pause hooks (Windows-MCP `control_win32.py`): the take-over key stays until a user reports it as too slow.

## Known limit that stays

No driver read here types into a background Electron window on Windows. agent-desktop issue #395 asks for it. cua's matrix
refuses it (`docs/action-support.md`, Electron row). dsh's source says Chromium, Electron and UWP often drop posted
messages. The spec promises an honest refusal, not a fix.

## Acceptance criteria

- [ ] M8-38a. The benchmark runs the built-in driver on the WinForms and Electron fixtures and records snapshot time, success and pointer or focus disturbance per trial.
- [ ] M8-38b. A snapshot of the Electron fixture returns the page's own controls, not only the frame.
- [ ] M8-38c. Snapshot time on the largest fixture falls, measured before and after; if it does not, row 3 is dropped and that is recorded.
- [ ] M8-38d. An input the table marks as lost returns `background_unavailable` and sends nothing.
- [ ] M8-38e. The benchmark's sentinel reports no pointer movement across every trial (D78).

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Codex writes the tests for any part Claude builds, and the other way round.
- Record any mechanism taken from an Apache-2.0 source in `THIRD-PARTY-NOTICES.md`.
- No em dashes; comments say what the code does, not why.
