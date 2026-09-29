# Plugin system

Child #3 of the Metatrooper epic. Milestone 1. Effort: about 3.5 Claude Code days.

Depends on: child #1.

## What

Plugin system: manifest validation, install screen and approval, action runner with env stripping and tree kill, pane bridge, Claude and Codex/agy importers

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: plugin-manifest.schema.json, plugins.md.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M1-15. A plugin folder with a valid manifest adds an engine that appears in `engine` and can be bound to a role with no core code change; an invalid manifest is rejected with its schema errors.
- [ ] M1-16. An action's environment contains only the base variables and approved secrets (checked by a fixture action that prints its environment to a file); a hung action is killed with its child processes at its timeout.
- [ ] M1-17. An imported Claude Code plugin with one MCP server and one env key asks for `secrets:<KEY>`, and the value is not written to any Metatrooper file.
- [ ] M1-25a. An action spawned with the stripped environment can still run `npm` and a `.cmd` script by name.
- [ ] M1-25b. An imported MCP server whose config held a literal env value still starts after import through the MCP shim, and the value appears in no Metatrooper file or engine config in plain text (only in its `.dpapi` blob). With the variable missing, the session starts, that server reports the missing name, and a needs-you item appears.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
