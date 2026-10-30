# M8-37: Rename MetaTrooper to Ouros

Part of Ouros, Milestone 8. Priority: High. Effort: not sized. Depends on: none.
Status: his words 2026-10-31, "Metatrooper is becoming ororus". Reverses the 2026-10-04 name-kept decision.

## Source of truth

- Wasif, 2026-10-31; spec.md Milestone 8.

## Every place the name lives

- Display name, README, site, CHANGELOG, THIRD-PARTY-NOTICES, package names and headers.
- GitHub repo Wasif-ZA/metatrooper and its links and badges.
- The `troop` CLI, `troop.db`, the `~/.metatrooper` home, the `.troop/` project folder, pipe names, env vars such as TROOP_SESSION_ID.
- MCP tool and shim names; the `metatrooper-browser` and `metatrooper-desktop` servers.
- Vault references: skills, hooks and meta/scripts that call `projects/metatrooper/core/cli.ts`.

## Blocked on

- Scope (product name only, or CLI, home folder and repo too) and the compatibility window.

## Acceptance criteria

- [ ] M8-37a. A table of every old and new name is written before any change.
- [ ] M8-37b. A fresh install shows only Ouros in the UI, CLI help and README.
- [ ] M8-37c. An existing `~/.metatrooper` home starts under the new name with sessions, settings and secrets intact.
- [ ] M8-37d. The old CLI name prints a pointer or keeps working for a stated window.
- [ ] M8-37e. README links and badges resolve after the repo rename.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for any fix Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
