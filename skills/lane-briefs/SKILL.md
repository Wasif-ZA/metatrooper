---
name: lane-briefs
description: Split a big piece of work into lanes, write one brief file per lane, launch each lane as its own agent session on its own worktree, and keep orchestrating until every lane writes DONE.md. Use for overnight or unattended runs, when the user says "use other sessions", "split the work", "run this overnight", or when one agent has been grinding on too much work for too long.
---

# lane-briefs

A lane is a separate agent session with one job, one worktree and one brief. The orchestrator
(you) writes briefs, launches lanes, watches them and merges. Lanes do the work.

## 1. Cut the lanes

- One lane per piece that can be finished and checked alone. Two lanes never edit the same file.
- A lane that would take more than a few hours is two lanes.
- Subagents inside a session are helpers for a lookup or one check. Real work goes to a lane.

## 2. Write each brief

`.troop/lanes/<run>/<lane>/BRIEF.md`, with absolute paths throughout (a new worktree does not
contain untracked files):

```markdown
# Lane <name>
Goal: <one sentence: the finished state, observable>
Base: <branch and commit>. Work on branch <lane-branch> only.
Do: <numbered steps, each naming files>
Do not touch: <paths other lanes own>
Check: <exact command that must pass>
Done means: <check output, plus what the user should see on screen>
When done, write <abs path>/DONE.md: what changed (commits), the check output copied in full,
anything left open. If blocked, write BLOCKED.md with the question and stop.
Run to the end without asking questions. Do not stop after a plan.
Never push, merge to main, or open PRs.
```

## 3. Launch

One jobs file for all lanes, then one call:

```json
[{"engine": "claude", "worktree": "<lane-branch>", "prompt": "Read <abs>/BRIEF.md and do it end to end."}]
```

`troop launch --jobs .troop/lanes/<run>/jobs.json --json`. Mix engines: give mechanical lanes
to cheaper engines and keep judgement lanes on the strongest one.

## 4. Orchestrate without idling

- Never sit waiting on one lane. While lanes run: review finished lanes, write the next briefs,
  check the merged result.
- `troop sessions --json` shows state. `troop read <id> --json` shows what a lane is doing.
- A lane in `waiting_for_you` needs the user: tell them and move on. Never answer it yourself.
- A bug found while orchestrating becomes a new lane or a note to the owning lane
  (`troop send <id> <text> --json`). The orchestrator does not fix it inline.
- A lane silent for far longer than its siblings: read its terminal, then resteer or restart it
  with a brief that says what it left behind.

## 5. Merge

For each DONE.md: rerun its check yourself, read the diff, merge the branch into an integration
branch, rerun every check there. Report per lane: done, blocked, or failed, with the evidence.
