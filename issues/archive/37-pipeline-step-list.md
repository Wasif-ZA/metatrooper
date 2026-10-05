# Pipeline step list and restyled editor

Child #37 of the UI revision epic (issues/archive/ui-revision-epic.md). M1 revision. Effort: about 2 Claude Code days.

Depends on: #34.

## Source of truth

- issues/archive/ui-revision-epic.md, sections: D16, D17.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] UI-08: a spec-to-pr run shows its step list with live status, gates as inline rows, a failing step expanded without a click.
- [ ] Editor restyled as a side-split tab; drag to reorder; JSON toggle and validate on save kept.

## Rules that bind every child

- Never push or open PRs from an agent; hand back the command.
- Codex writes the tests for #33.
- No em dashes; comments say what the code does, not why.
