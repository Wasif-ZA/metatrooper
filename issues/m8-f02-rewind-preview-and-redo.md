# M8-F2: Rewind preview and redo

Part of Ouros, Milestone 8, feature 2 of 12. Rides on: M8-13. Screen: `kit/specs/f-rewind.json`.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 6e (6e checkpoints), "Features that make the loops visible".
- Scratch: `ouros-startpoint-2026-10-30/features/FEATURE-LIST.md` row A2; board `ouros-ide-fiveshot-2026-10-30/NEWFEATURES.html`; shot `kit/shots/features/f-rewind.png`.

## What it does

Each file listed as reverted, skipped (shell-made, not tracked) or unknown; stops on files changed since the checkpoint; lessons and exported instructions from the run are rolled back in the same step; redo until your next message

## Evidence

Codex /undo 541 reactions, /rewind 231; Claude Code undo 178; /rewind silently fails on Bash-edited files 44; Zed restore "irreversibly destructive" 17

Rewind with files is matched by rivals: opencode, Gemini CLI, Cline, Conductor and Replit have it (RIVALS.md row 3). It is expected, not a difference.

New screen, 2026-11-05: `~/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/workspaces/n23-rewind.json`, shot `proto/shots/r-rewind.png`. It follows Google Docs version history, and Restore and Show changes follow Google Slides history. It replaces `f-rewind.json` as the layout. Also in the wip repo at `ouros/direction`.

## Blocked on

- Wasif's keep / change / drop on NEWFEATURES.html feature 2.
- CORE.html proposes a snapshot per run first and per turn later. Section 6e says every turn. His call.

## Acceptance criteria

- [ ] M8-F2a. Each file listed as reverted, skipped (shell-made, not tracked) or unknown.
- [ ] M8-F2b. stops on files changed since the checkpoint.
- [ ] M8-F2c. lessons and exported instructions from the run are rolled back in the same step.
- [ ] M8-F2d. redo until your next message.
- [ ] M8-F2e. The shipped screen matches `f-rewind.json` and passes validate.mjs.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
