# M7-15: The five material looks as extra themes

Part of the MetaTrooper desk epic (becoming Ouros), Milestone 7. Priority: Low. Effort: not sized. Depends on: none.
Status in scratch: approved (material round 1: all kept as themes).

## Source of truth

- ~/.cache/claude-scratch/metatrooper-material-2026-10-10/STATE.md, PLAN.md, mats/1-ember to 5-factory; ~/.cache/claude-scratch/metatrooper-panes-2026-10-10/PLAN.md; core/src/settings.ts 61-100

## What was designed

- Settings has 7 themes (dither, charcoal, graphite, paper, terminal, slate, light); Ember, Cream, Glyph, Ring and Factory light are missing.
- Each ships as a ui.themes entry: a colour set plus a look stylesheet (edges, radius, motion). Flat colour, no texture, glow or glass; orange only for "you can act".
- Known bug to recheck: `.btn.acc:hover` blanked the "+ New" label on non-dither themes.

## Blocked on

- Confirm the names and count (PLAN says five, STATE six).

## Acceptance criteria

- [ ] M7-15a. Each look appears as "Theme: <name>" and survives a restart.
- [ ] M7-15b. Hovering "+ New" keeps its label readable on every look.
- [ ] M7-15c. Wall, Ctrl+B list, Ctrl+K, approval card, Diff, Git and Browser panes render with no unstyled element (page-check plus screenshots).
- [ ] M7-15d. Dither stays the default; setTheme still rejects prototype keys.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for any fix Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
