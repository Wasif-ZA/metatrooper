---
name: troop
description: Start and follow MetaTrooper agent sessions from inside an agent session with the troop CLI.
---

# troop

Use the `troop` CLI to work with MetaTrooper's core. Always pass `--json` and read the JSON output.

## Start and follow agents

1. `troop launch <engine> --project <path> --prompt <text> --json` starts an agent and returns its `session_id`.
   Example: `troop launch codex --project . --worktree fix-login --prompt "fix the login test" --json`.
2. `troop launch --jobs <jobs.json> --json` starts several at once from `[{"engine","worktree","prompt"}, ...]`.
3. `troop sessions --json` lists sessions and their state (`working`, `waiting_for_you`, `done`, `idle`, `exited`).
4. `troop owners --json` lists the project's uncommitted files and the session that owns each.

## Waiting for you

A session in `waiting_for_you` needs the human. Report it to the user and stop. Do not answer
another agent's prompt yourself.

## Rules

- Never commit, push or open PRs. Print the command for the user to run.
- If `troop ping` fails, the core is not running. Tell the user to start it with `troop serve`.
