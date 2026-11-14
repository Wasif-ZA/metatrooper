# M8-23: Self-healing, resume and run health under the UI

Part of Ouros, Milestone 8. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-13.
Status in scratch: approved with fixes (two-engine-r4/reconcile.md).

## Source of truth

- `spec.md` Milestone 8 row M8-23; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): two-engine-r4/reconcile.md; round-4/ide4.html?s=heal|resume|budget|wall; round-4/ide4.js (thread and status-bar states only, never separate screens).

## What was designed

- Heal lines are marked with a circle arrow and count infra recoveries only: a 529 retried with backoff (attempt 1 of 5), truncated JSON repaired, a loop stopped. A test fix and re-run is not "healed". Status bar: "3 healed".
- Resume (decided 2026-11-10: one log line, "resumed after close", not a card) after a crash or close: restores the checkpoint, keeps the user's edit, re-runs and lists what it replayed; send and deploy steps always ask first; never promises "nothing lost".
- Budget meter: 80% is a grey log line ("keeps working"), 100% is a true gate then a handoff; the tile footer reads e.g. "164k of 200k tokens".
- Loop detection becomes a decision card only after bounded alternatives and no progress. Compaction is never forced.
- Ideas not taken yet, his call: LSP errors fed to the agent after each edit, orphan dev-server reaping, stale .git/index.lock clearing, operation ids so a resumed call does not run twice, one budget shared by child agents.

## Blocked on

- The four deep-dive calls (provider fallback, honest abort, fresh reviewer, pinned defaults) and the five ideas not taken.

## Acceptance criteria

- [ ] M8-23a. A simulated 529 makes a retry line with its attempt count and the healed count rises by 1.
- [ ] M8-23b. A failing test the agent fixes does not raise the healed count.
- [ ] M8-23c. Killing Ouros mid-run shows the resume card on reopen with the replayed steps listed.
- [ ] M8-23d. A deploy step is never replayed without asking.
- [ ] M8-23e. 80% budget logs without stopping; 100% raises a gate.
- [ ] M8-23f. Nothing forces compaction.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
