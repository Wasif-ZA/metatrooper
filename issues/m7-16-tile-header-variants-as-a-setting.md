# M7-16: Tile header variants as a setting

Part of the MetaTrooper desk epic (becoming Ouros), Milestone 7. Priority: Low. Effort: not sized. Depends on: M6-27.
Status in scratch: approved to save ("save the others as ways to customise").

## Source of truth

- ~/.cache/claude-scratch/metatrooper-tile-header-2026-10-10/STATE.md, variants.py, RESEARCH.md; workbench app.js:879

## What was designed

- Today the setting changes only the state colour. Saved structures: v1 slim bar with one verb, v3 tab plus sub-bar, v4 status line, v5 ask bar.
- NEEDS YOU and Hand back stay visible at rest in every variant; Pair stays a button.
- The ask bar shows only the notification class and tool name (redact.js drops the text); Codex and Gemini send no ask signal.
- v3 overlaps M7-7 drag to pair; decide together.

## Blocked on

- Which of v1, v3, v4, v5 ship, and whether v3 waits for M7-7.

## Acceptance criteria

- [ ] M7-16a. A Tile header setting offers the default plus at least slim bar and status line, kept across restarts.
- [ ] M7-16b. Switching never changes tile order, focus or terminal size.
- [ ] M7-16c. Needs-you and Hand back show at rest in every variant.
- [ ] M7-16d. A Codex tile shows no ask text; the close button follows M6-27.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for any fix Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
