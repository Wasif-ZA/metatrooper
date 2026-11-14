# M8-13: Run budget, loop 1, hash watcher and checkpoints

Part of Ouros, Milestone 8. Build step G13. Priority: Critical. Effort: not sized (sized after M8-0). Depends on: M8-3.

## Source of truth

- `ouros-spec.md` section 6e, 7; `spec.md` Milestone 8 children table row M8-13.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

The product core: agents fix their own mistakes. Built first because each part is cheap and measurable alone. Read first: cline checkpoints and loop-detection.ts (Apache-2.0), OpenHands stuck_detector.py (MIT), opencode tool-input-repair.ts and doom_loop (MIT).

No screens (decided 2026-11-10, D83). Settings entries: see ouros-spec.md, Settings tree, Reliability.

## Blocked on

- NEWFEATURES.html keep/change/drop on these six; the four deep-dive calls (provider fallback, honest abort, fresh reviewer, pinned defaults).

## Acceptance criteria

- [ ] M8-13a. A failing test sends the agent back with the output.
- [ ] M8-13b. An edit to a protected test changes nothing; the judge runs from a host-held copy.
- [ ] M8-13c. A retry rewinds files first, then starts from a clean context with a short summary.
- [ ] M8-13d. A run with no acceptance check ends as "needs your review"; a missing test runner is not a pass.
- [ ] M8-13e. Every nudge is logged; a faked provider outage cools down, probes, and asks before any fallback.
- [ ] M8-13f. Injected faults (timeout, malformed call, loop, crash mid-run) each end in the loop meant for them.
- [ ] M8-13g. An agent write to a file another tool executes (hooks, .vscode/tasks.json, MCP configs) stays inactive until approved.
- [ ] M8-13h. Done means proven: a run ends as Done, Checks passed or Needs your review; Done is bound to revision, command, environment and the acceptance check, and cleared by any later edit. The toggle and the acceptance command are in Settings > Reliability > Finishing.
- [ ] M8-13i. Rewind preview and redo (a sheet from Undo, not a screen): each file listed as reverted, skipped or unknown; stops on files changed since the checkpoint; redo until the next message.
- [ ] M8-13j. Repair ladder: tries 1 to 3, each after a rewind; the last may use a stronger model; a wanted test change goes to its own review. Settings > Reliability > Repair.
- [ ] M8-13k. Progress-aware loop alarm: nudge at 3 identical calls with no new output, stop at 5; declared polling exempt; false alarms counted. The thresholds are in Settings > Reliability > Watching.
- [ ] M8-13l. Your rules as checks: each rule is listed in Settings > Reliability > Your rules with what enforces it or that it is only read, and a caught count.
- [ ] M8-13m. Long runs that survive: runs keep going when Ouros closes; reattach; never re-run an unsafe tool call without asking.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
