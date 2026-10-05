# Layout shell: 3 render rounds, then session list, big terminal, tile grid, Ctrl+K palette, status strip, side split, first screen

Child #34 of the UI revision epic (issues/archive/ui-revision-epic.md). M1 revision. Effort: about 4 Claude Code days.

Depends on: #33 (code only; renders start day one).

## Source of truth

- issues/archive/ui-revision-epic.md, sections: Render rounds (#34), Workbench.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] Three render rounds, five options each, picked by Wasif; round-3 pick recorded before any layout code.
- [ ] Today's click counts for the five jobs recorded in UI-STATUS.md before any layout code.
- [ ] UI-03 window half: close mid-turn, reopen after 10 s, last 200 rows match.
- [ ] UI-04: no click count is higher than today's and at least 3 of the 5 are lower.
- [ ] UI-10 echo half: 6 tiles at 200 lines a second, keystroke echo under 50 ms.

## Rules that bind every child

- Never push or open PRs from an agent; hand back the command.
- Codex writes the tests for #33.
- No em dashes; comments say what the code does, not why.
