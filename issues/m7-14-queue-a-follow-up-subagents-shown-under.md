# M7-14: Queue a follow-up; subagents shown under their parent tile

Part of the MetaTrooper desk epic (becoming Ouros), Milestone 7. Priority: Medium. Effort: not sized. Depends on: M6-23.
Status in scratch: verdict pending (UI research section 2).

## Source of truth

- ~/.cache/claude-scratch/metatrooper-ui-research-2026-10-12/report.html section 2 items 1 and 2; contracts/events-and-hooks.md

## What was designed

- Queue: type the next message while the agent works; a "1 queued" chip on the tile; sent when the session goes idle or done, with Send now. Evidence t3code #231 (77), #538 (36). Overlaps Ouros queue and steer (M8-19).
- Subagents: "3 subagents, 1 running" on the tile. Needs the SubagentStop hook installed and a contract change; Claude only at first.

## Blocked on

- Whether subagents earn a hook and contract change.

## Acceptance criteria

- [ ] M7-14a. Queued text is sent exactly once when the state first becomes idle or done.
- [ ] M7-14b. Editing or clearing it before then sends nothing.
- [ ] M7-14c. A fixture Claude session with 2 running subagents shows "2 running" and drops to 0 on their stops.
- [ ] M7-14d. The contract table lists the new hook; engines with no signal show no chip.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for any fix Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
