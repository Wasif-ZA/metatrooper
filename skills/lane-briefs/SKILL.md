---
name: lane-briefs
description: Run a big piece of work as several troop sessions ("lanes"), each with a brief file on disk and its own worktree, and keep orchestrating until every lane writes DONE.md. Use when work will run as troop sessions, for overnight or unattended runs, or when the user says "use other sessions", "run this overnight". For short helpers inside this session, use dispatching-parallel-agents instead.
---

# lane-briefs

A lane is a separate agent session with one job, one worktree and one brief. The orchestrator
(you) writes briefs, launches lanes, watches them and reviews. Lanes do the work. Nobody commits:
lanes leave changes uncommitted in their worktree and the user commits and merges.

## 1. Cut the lanes

- One lane per piece that can be finished and checked alone. Two lanes never edit the same file.
- A lane that would take more than a few hours, touches unrelated areas, or mixes judgement with
  mechanical work is two lanes.
- Subagents inside a session are helpers for a lookup or one check, under about 10 minutes. Real
  work goes to a lane.

## 2. Write each brief

`.troop/lanes/<run>/<lane>/BRIEF.md`, with absolute paths throughout (a new worktree does not
contain untracked files):

```markdown
# Lane <name>
Goal: <one sentence: the finished state, observable>
Base: <commit>. Work in this worktree only.
Expected time: <minutes>
Do: <numbered steps, each naming files>
Do not touch: <paths other lanes own>
Check: <exact command that must pass>
Done means: <check output, plus what the user should see on screen>
When done, write <abs path>/DONE.md: `git status --short` output, what each change does, the
check output copied in full, anything left open. If blocked, write BLOCKED.md with the question
and stop.
Run to the end without asking questions. Do not stop after a plan.
Never commit, push, merge or open PRs. Leave the changes uncommitted.
```

## 3. Launch

`troop launch --worktree` creates a new branch from the project's current HEAD. Check out the base
named in the briefs before launching, and confirm `git rev-parse HEAD` matches it.

One jobs file for all lanes, then one call:

```json
[{"engine": "claude", "worktree": "<lane-branch>", "prompt": "Read <abs>/BRIEF.md and do it end to end."}]
```

`troop launch --jobs .troop/lanes/<run>/jobs.json --json`. Record the session id each launch
returns; these are the only sessions this run owns. Pick engines per lane with `engine-routing`.

## 4. Orchestrate without idling

- Never sit waiting on one lane. While lanes run: review finished lanes, write the next briefs.
  `troop wait` is for when there is truly nothing else to do.
- `troop sessions --json` shows state. `troop read <id> --json` shows what a lane is doing.
- A lane in `waiting_for_you` needs the user: report it to them and stop. Never answer it
  yourself.
- At twice a lane's expected time, read it with `troop read <id> --json`, then resteer it with
  `troop send <id> <text> --json`, split it, or relaunch with a sharper brief that says what the
  last attempt left behind.
- A bug found while orchestrating becomes a new lane or a note to the owning lane. The
  orchestrator does not fix it inline.
- Only act on session ids this run launched.

## 5. Review and hand back

For each DONE.md: rerun its check in that worktree yourself and read the diff. Then give the user
one list, per lane: done, blocked or failed, with the evidence, and for each done lane the exact
commands to commit it and merge it into an integration branch. When a lane's result is taken,
hide its session (`troop hide <id>`) and report how many are still running and why.
