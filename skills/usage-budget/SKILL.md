---
name: usage-budget
description: Plan a long or overnight run against the user's remaining model usage - estimate cost up front, set checkpoints, shift work to cheaper capable engines as usage climbs, and stop cleanly before the limit with a resume note. Use before any unattended run, when the user mentions their usage percent or limits, or asks "how many tokens will this take".
---

# usage-budget

Running out mid-task wastes everything not yet saved where the next session can find it. Budget
like it is money.

## 1. Before the run

- Get the remaining usage per engine as a number the user or the engine reports (a percent of the
  plan's limit). The user's number beats any guess. Wall-clock minutes are not usage.
- Estimate in the same unit: how much usage similar tasks took before. Show the working:
  "8 lanes x about 4% each = 32%, 41% left".
- If there is no past figure, say so and estimate from the task count, then check after the
  first task and re-estimate.
- If the estimate is above what is left, cut scope now and say what was cut. Do not start a run
  that cannot finish.

## 2. Checkpoints

Read usage again at about 50%, 75% and 90% of the budget. If no reading is available unattended,
use task count instead (after a half, three quarters and nine tenths of the tasks) and say so.

- **50%**: is progress on track with the estimate? If not, say why and re-plan.
- **75%**: move a remaining task to a cheaper engine only where `engine-routing` says that engine
  can pass its check. Otherwise cut the task and list it.
- **90%**: stop starting new work. Leave finished changes uncommitted where they are, write a
  resume note (done, decided, the exact next step, uncommitted files), and stop every session
  you started.

## 3. Cheap by default

Reuse earlier work before making new (`reuse-first`) and keep context small (`lean-context`).

## Report

End with: budget, used, tasks done, tasks left, and the one change that would have saved the
most.
