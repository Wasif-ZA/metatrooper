# M8-24: Usage popover and token savers

Part of Ouros, Milestone 8. Priority: Medium. Effort: not sized (sized after M8-0). Depends on: M8-17.
Status in scratch: approved, every saver default off (two-engine-r4 final).
**Start on or after 2026-11-09.**

## Source of truth

- `spec.md` Milestone 8 row M8-24; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): round-4/ide4.html?s=cost; round-4/ide4.js cost; two-engine-r4/reconcile.md; research/next/PAINS.md #1.

## What was designed

- Usage popover (not a tab): "412k tokens" today with a Today / Week / Run switch.
- "Where it went": file reads 190k, shell output 88k, screenshots 52k, instructions 41k, model replies 41k; per-agent bars; shows both 9.8% (Bash + Read) and about 18% (Bash only); counts cache reads and writes.
- Four savers, controlled in Settings > Savings, all off until an A/B on his own tasks wins: shrink shell output (his metarouter setup carries over), lean handoffs (between tasks only, transcript kept), smaller screenshots (no promised percentage), cheapest model per step (only for steps with a check).
- A repeat-read note appears in the Usage popover only: never in the prompt, never blocks Read. A spend line sits in the status bar.
- 2026-11-05: new screens `~/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/workspaces/n10-usage.json` (limits per engine, and a plain note on what happens at 80% and 100%) and shot `proto/shots/r-usage.png`. Core service "Cost per task" in CORE.html: spend so far and a stop at your limit, labelled an estimate. The stop is M8-13's run budget. Money caps per agent stay parked in M8-48.

## Blocked on

- The deferred "unchanged since step N" re-read shortcut (conflicts with native Read).

## Acceptance criteria

- [ ] M8-24a. The Usage numbers sum to the headline total.
- [ ] M8-24b. Every saver is off by default and shows a saving only after a measured A/B.
- [ ] M8-24c. A repeated read is flagged in the Usage popover; Read is never blocked.
- [ ] M8-24d. Today / Week / Run changes the figures.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
