---
name: work-sizing
description: Size and split work so no agent carries too much and no agent sits idle - subagents only for short helper jobs, real work in separate sessions, a time box on every task, and the orchestrator always doing something useful. Use when delegating, when an agent has run far longer than expected, or when the user says "split the work", "why is this taking so long", "don't wait on subagents", "sessions are idle".
---

# work-sizing

Two ways to waste time: one agent grinding for an hour on what three could do in fifteen
minutes, and agents waiting on each other.

## Size each task

- **Subagent**: a lookup, one check or a short fix, under about 10 minutes. Nothing that needs
  its own branch.
- **Session** (`troop launch`): anything bigger - a build, a fix pass, an audit, a design round.
  Its own worktree, its own brief.
- **Split it** if a task touches unrelated areas, would take over an hour, or needs different
  kinds of model (judgement vs mechanical).

## Time-box every task

Give each task an expected duration when you hand it out. At twice that, check it:
`troop read <id> --json`. Then decide - resteer with `troop send`, split it, or restart with a
sharper brief. Never let it run on unexamined.

## Never idle

While anything you started is running:

- Review what has finished. Rerun its check.
- Write the next brief.
- Do the next independent task yourself.

`troop wait` is for when there is truly nothing else to do. Waiting on one agent while others
sit idle is the failure this skill exists to stop. If sessions are idle and work is left, give
each one a task.

## Close what is finished

When a session or background job is done and its result is taken, stop it. Report how many
are still running and why.
