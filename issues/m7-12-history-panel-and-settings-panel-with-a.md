# M7-12: History panel and Settings panel, with a keybindings page

Part of the MetaTrooper desk epic (becoming Ouros), Milestone 7. Priority: Medium. Effort: not sized. Depends on: M6-26.
Status in scratch: decided (D81, 2026-10-12).

## Source of truth

- spec.md D81; issues/m6-26-wall-repairs.md line 116; ~/.cache/claude-scratch/metatrooper-ui-research-2026-10-12/report.html sections 1 and 2 item 4

## What was designed

- D81 and M6-26 moved both panels to M7, but no M7 row owns them.
- History: the list shows only the newest 50 non-hidden sessions (queries.ts:109). Add a searchable panel (task, engine, date) with Resume, and a Hidden filter, since the 7 s undo has no session.unhide.
- Settings: about 15 keys live only in settings.json (font size, scrollback, ask_paths, metarouter). The panel writes through settings.set, starting with the 5 most used.
- Keybindings page on top of Settings; Alt keys can clash with non-US layouts (cmux #1653).

## Blocked on

- Which 5 settings come first (optional).

## Acceptance criteria

- [ ] M7-12a. A session older than the newest 50 is found by task text and resumed from History.
- [ ] M7-12b. Changing terminal font size in Settings updates settings.json and open tiles without a restart.
- [ ] M7-12c. A bad value is refused with a message and the file is unchanged.
- [ ] M7-12d. A rebound wall key works on the next press and shows in the M6-26 Keys list.
- [ ] M7-12e. Esc closes both panels.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for any fix Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
