# Plugin system

Part of the MetaTrooper epic. Milestone 1. Effort: about 3.5 Claude Code days.

Depends on: child #12.

## What

Plugin system: manifest validation, install screen and approval, action runner with env stripping and tree kill, pane bridge, Claude and Codex/agy importers

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: plugin-manifest.schema.json, plugins.md.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [x] M1-15. A plugin folder with a valid manifest adds an engine that appears in `engine` and can be bound to a role with no core code change; an invalid manifest is rejected with its schema errors.
- [x] M1-16. An action's environment contains only the base variables and approved secrets (checked by a fixture action that prints its environment to a file); a hung action is killed with its child processes at its timeout.
- [x] M1-17. An imported Claude Code plugin with one MCP server and one env key asks for `secrets:<KEY>`, and the value is not written to any MetaTrooper file.
- [ ] M1-25a. An action spawned with the stripped environment can still run `npm` and a `.cmd` script by name.
- [x] M1-25b. An imported MCP server whose config held a literal env value still starts after import through the MCP shim, and the value appears in no MetaTrooper file or engine config in plain text (only in its `.dpapi` blob). With the variable missing, the session starts, that server reports the missing name, and a needs-you item appears.

Status 2026-09-29: ticked boxes pass in `core/test/plugins.test.ts` on Linux, with `METATROOPER_FAKE_DPAPI=1`
standing in for DPAPI and a process-group kill standing in for `taskkill`. M1-25a's `npm` half passes; its `.cmd`
half is a Windows-only test that has not run yet. The install screen's UI is child #16; the core side
(`plugin.preview`, `plugin.install`) and `troop plugin install` are built.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.
