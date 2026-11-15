---
name: engine-routing
description: Send each piece of work to the cheapest engine and model that can do it well, with the strongest model only directing - writing exact instructions that cheaper models execute. Use before launching any agent or subagent, when usage is running high, or when the user says "use cheaper models", "use the other engines more", "you're eating my usage".
---

# engine-routing

The strongest model's tokens are the scarce ones. Spend them on decisions, not on typing.

## Tiers

| Work | Goes to |
|---|---|
| Hard calls: design choices, diagnosis, plans, reviewing a result | strongest model |
| Decided builds: a written plan with named files and a check command | a mid model or another engine |
| Mechanical: renames, bulk edits, extraction, formatting, test runs | cheapest model, or a local model |
| A second opinion | a different engine family, not the same model again |

`troop engines --json` lists healthy engines. Pick the model with `--model` on `troop launch`.

## Direct, then delegate

When the strongest model decides something, it writes the result as an exact script for a
cheaper model: the files, the edits as before/after text, the check command, and what "done"
means. A cheaper model following an exact script is fast and rarely wrong; the same model
guessing from a vague brief wastes both runs.

## Fall back, never stall

- An engine rate-limited or failing to start: switch to the next healthy one in the same tier
  and say so in one line. Do not retry the broken one in a loop.
- A cheap model failed the check twice: move that task up one tier.

## Report

At the end, one line per engine: tasks given, tasks passed. That shows whether the routing held.
