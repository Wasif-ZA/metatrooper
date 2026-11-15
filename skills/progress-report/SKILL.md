---
name: progress-report
description: Answer "how far are you", "ETA?", "what's done and what's left", "is it stuck?", "what are the sessions doing" with a short, evidence-backed status, percent done and an estimate drawn from how long similar steps actually took. Use whenever the user asks for status, progress, an ETA or why something is taking long.
---

# progress-report

Lead with the answer. The user often reads two lines and moves on.

## Gather (do not guess)

- Your own task list or plan: which steps are finished, by evidence (a passing check, a commit),
  not by intent.
- Every agent you started: `troop sessions --json` for state, `troop read <id> --json` for the
  last lines of any that look stuck.
- Timing: when each finished step started and ended. Use commit times, plus whatever times
  `troop sessions --json` shows. If neither has them, note the time yourself at each step.

## Report shape

```text
<n>% done. ETA <time>, from <basis>.
Done: <items, each with its evidence>
Running: <session or job> - <what it is doing now>
Left: <items>
Blocked on you: <items, or "nothing">
```

## The estimate

- Percent is finished steps over total steps, weighted by size if steps differ a lot. Say so.
- ETA comes from measured times: "the last 3 lanes took 25 to 40 min each; 2 left, so about
  50 to 80 min". Show that working.
- No basis yet? Say "no estimate until the first step finishes" rather than inventing one.

## When it looks stuck

A session with no new output for much longer than its siblings: read its terminal, say what it
is doing or waiting on, and what you will do about it (resteer, restart, or leave it).
Never report "working on it" without naming what is happening.
