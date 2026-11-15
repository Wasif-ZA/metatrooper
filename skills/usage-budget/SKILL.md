---
name: usage-budget
description: Plan a long or overnight run against the user's remaining model usage - estimate cost up front, set checkpoints, shift work to cheaper engines as usage climbs, and stop cleanly before the limit with a resume note. Use before any unattended run, when the user mentions their usage percent or limits, or asks "how many tokens will this take".
---

# usage-budget

Running out mid-task wastes everything since the last commit. Budget like it is money.

## 1. Before the run

- Ask or read the remaining usage per engine (the user's number beats any guess).
- Estimate: count the tasks, and for each, how long similar tasks took before. Show the working:
  "8 lanes x about 40 min, 3 on the strongest model, 5 on cheaper engines".
- If the estimate is above what is left, cut scope now and say what was cut. Do not start a run
  that cannot finish.

## 2. Checkpoints

Set checkpoints at about 50%, 75% and 90% of the budget. At each:

- **50%**: is progress on track with the estimate? If not, say why and re-plan.
- **75%**: move every remaining build task to cheaper engines (see `engine-routing`). The
  strongest model only reviews.
- **90%**: stop starting new work. Commit what is done on its branch, write a resume note
  (done, decided, the exact next step), and stop every session you started.

## 3. Cheap by default

- Reuse earlier research and outputs before making new ones (`reuse-first`).
- Route long command output through `troop route exec -- <command>` instead of reading it raw.
- Read files by the range you need, not whole.
- Do not re-read a file you just wrote or edited.

## Report

End with: budget, used, tasks done, tasks left, and the one change that would have saved the
most.
