# M7-17: Pane-by-pane redesign rounds 2 to 12

Part of the MetaTrooper desk epic (becoming Ouros), Milestone 7. Priority: Low. Effort: not sized. Depends on: none.
Status in scratch: process approved, no rounds run.

## Source of truth

- ~/.cache/claude-scratch/metatrooper-panes-2026-10-10/PLAN.md

## What was designed

- Not yet run: Ctrl+K mode prefixes and recents first; agent list hover card and hidden count; Diff "x/y viewed" and totals; Git Commit and push and a WIP row; Hand back merged into Git; at most 2 toasts naming the exact ask; footer live counts; start-screen picker search; browser pane owner, handoff with Give back, cursor collisions; take-over pause state.
- Some may have landed as UI-01 to UI-22; check before a round.
- Locked: wall of live terminals, slim title bar, Ctrl+B list, floating Ctrl+K, GSAP motion, two-line header, Zed crumb bar, quiet strip, Diff pick 1, Git pick 2, sectioned picker, browser E, no "gate" in UI copy.

## Blocked on

- Whether this still runs now that Ouros is the IDE and the wall may be superseded.

## Acceptance criteria

- [ ] M7-17a. Each pane gets its own five-version round in the real wall, with a phone-first board and his pick recorded.
- [ ] M7-17b. A picked pane is built on a branch with the workbench suite green, and he sees it on screen.
- [ ] M7-17c. Nothing locked changes; unpicked versions become settings.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for any fix Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
