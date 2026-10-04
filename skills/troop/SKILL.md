---
name: troop
description: Start and follow MetaTrooper pipeline runs from inside an agent session with the troop CLI.
---

# troop

Use the `troop` CLI to run MetaTrooper pipelines. Always pass `--json` and read the JSON output.

## Run a pipeline

1. `troop run start <pipeline> --project <path> --json` starts a run and returns its `run_id`.
   Example: `troop run start two-engine-review --project . --json`.
   Add `--input key=value` for pipeline inputs.
2. `troop run wait <run_id> --json` blocks until the run pauses (gate, budget, loop-max, breaker,
   handoff) or ends. Add `--timeout <s>` to bound the wait.
3. `troop run status <run_id> --json` shows the run state and any open gates.

## Gates

A gate is a decision for the human. Report the gate summary to the user and stop. Do not resolve
gates yourself; only the workbench UI can.

## Rules

- Never commit, push or open PRs. Print the command for the user to run.
- If `troop ping` fails, the core is not running. Tell the user to start it with `troop serve`.
