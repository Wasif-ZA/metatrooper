# M8-48: Parked board rows: on the list, not built

Part of Ouros, Milestone 8. **After launch.** Priority: Low. Effort: not sized until M8-0. Depends on: none.
**Only on his yes per row.**

Grouped so that no row is lost. This is a holding list, not a build.

## Source of truth

- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/board.py`, the rows below (also `ouros/direction` in the wip repo).
- His direction, 2026-11-05: "have all means having nothing".

## The rows

| Row | Board note | Screen | If he says yes |
|---|---|---|---|
| Community looks: dense, chat, kanban, playful | Board said skip: only useful once there are users | `n08-plugins.json` | Add-on over M8-14 |
| Ticket board | Board said skip: GitHub already does this | `n11-issues.json`, Board tab | Add-on over M8-F20 |
| Team chart: roles, reporting, assign work | Board said skip: a different product, for running a company | `n12-team.json` | Add-on, with M8-F21 kept separate |
| Money caps per agent | Board said skip: most users pay a flat plan | `r-usage.png` | M8-13 run budget and M8-24 cover spend per task first |
| Cloud hosting | Board said skip: conflicts with local-only and costs money to run | none | Add-on |
| Company controls: private cloud, roles, SOC 2 | Board said skip: nobody is asking yet | none | Add-on |
| Import browser logins | Later, built in | none | Needs a security review of its own: stored logins are secrets |
| Design mode | Later, add-on | `n09-browser.json` | Add-on over M8-F19 |

## Blocked on

- Keep or drop on each row. His call.

## Acceptance criteria

- [ ] M8-48a. Each row has his keep or drop written here before any work starts.
- [ ] M8-48b. A kept row gets its own issue file and a row in `spec.md`.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- No em dashes.
