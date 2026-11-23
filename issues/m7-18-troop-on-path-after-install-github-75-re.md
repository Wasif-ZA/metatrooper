# M7-18: troop on PATH after install (GitHub #75, renumbered)

Part of the MetaTrooper desk epic (becoming Ouros), Milestone 7. Priority: High. Effort: not sized. Depends on: M8-37 name call.
Status: verified unbuilt.

## Source of truth

- GitHub #75 (titled M7-11, which clashes with issues/m7-11-box-offload.md)
- core/package.json declares bin troop; router/bin ships only metarouter shims

## What is open

- Two items claimed M7-11. Box offload keeps M7-11; #75 becomes M7-18.
- Agents told to use the MetaTrooper browser fail with `troop: command not found`; the troop skill never covers a missing binary.
- If the rename (M8-37) changes the CLI name, decide it first.

## Blocked on

- Whether the CLI keeps the name troop after M8-37.

## Acceptance criteria

- [ ] M7-18a. troop.cmd and a POSIX troop shim run core/cli.ts and sit on PATH next to metarouter.
- [x] M7-18b. `troop ping --json` works from a fresh PowerShell and a fresh Git Bash. (2026-11-24, scoped per the orch decision 00:42: holds in every shell cc launches, which gets router/bin first on PATH through launch.ts metarouterLaunch; a plain terminal needs the README line from b3/cc-1124 09ddcb37, no saved-PATH edit. B3 checked troop ping --json rc 0 in PowerShell with only the registry PATH plus router/bin.)
- [ ] M7-18c. The troop skill says what to do when the command is missing.
- [ ] M7-18d. A test asserts the shim exists and resolves to core/cli.ts.
- [ ] M7-18e. GitHub #75 is retitled M7-18 and synced from this file.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for any fix Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
