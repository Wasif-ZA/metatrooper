---
name: engine-routing
description: Pick which engine and model runs each delegated task - the cheapest one that can pass the task's check, with the strongest model only directing through exact instructions. Use when choosing an engine or model for work you are handing off, when usage is running high, or when the user says "use cheaper models", "use the other engines more", "you're eating my usage". If the user or the plan already named the engine, or the plan says to work inline, follow that instead.
---

# engine-routing

The strongest model's tokens are the scarce ones. Spend them on decisions, not on typing.

## Tiers

Capability first: a task goes to the cheapest engine that can pass its check, never a cheaper one
that cannot.

| Work | Goes to |
|---|---|
| Hard calls: design choices, diagnosis, plans, reviewing a result | strongest model |
| Decided builds: a written plan with named files and a check command | a mid model or another engine |
| Mechanical: renames, bulk edits, extraction, formatting, test runs | cheapest model, or a local model |
| A second opinion | a different engine family, not the same model again |

`troop engines --json` lists which engines are installed and healthy. It does not list models or
prices: take model names and their relative cost from the user or the engine's own docs, then
pass one with `--model` on `troop launch`.

## Clear it before it leaves the machine

A remote engine is an external send. Before routing a task to one, check the user has cleared that
code and data to leave the machine (as in `second-opinion`). Uncleared work stays on a local model
or the engine already holding it.

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
