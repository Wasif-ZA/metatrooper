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

## Decision so far

- Wasif, 2026-10-31: no code change now; this file is the how-to. Scope and window below are proposals until he
  picks them.

## Name table (M8-37a)

Counts from `git grep` on main, 2026-10-31.

| Old | New | Where | Count |
|---|---|---|---|
| MetaTrooper / metatrooper (prose, UI, README, site) | Ouros | docs, UI strings, window titles | 1,231 hits in 315 files |
| repo `Wasif-ZA/metatrooper` | `Wasif-ZA/ouros` | GitHub, README badges, links | - |
| `projects/metatrooper` | `projects/ouros` | vault folder, `operators/relocate.py` | - |
| npm `metatrooper`, `@metatrooper/core`, `@metatrooper/workbench` | `ouros`, `@ouros/core`, `@ouros/workbench` | package.json files | 3 |
| CLI `troop` | `ouros` | `core/package.json` bin, docs, skills | 177 files |
| `METATROOPER_*` env vars (18 names) | `OUROS_*` | core, workbench, tests | METATROOPER_HOME alone 250 |
| `TROOP_*` env vars (22 names) | `OUROS_*` | core, plugins, tests | TROOP_SESSION_ID alone 86 |
| `~/.metatrooper` | `~/.ouros` | user home | 41 |
| `troop.db` | `ouros.db` | inside the home | 155 |
| `.troop/` project folder | `.ouros/` | inside each user project | 25 |
| `metatrooper-browser`, `metatrooper-desktop`, `metatrooper-demo` | `ouros-browser`, `ouros-desktop`, `ouros-demo` | MCP server names, demo ids | 58 |
| `router/troop-plugin.json`, `troop route` | `ouros-plugin.json`, `ouros route` | router | - |
| Named pipe prefix (`METATROOPER_PIPE_PREFIX` default) | ouros prefix | core IPC | 45 |

## How to do it: four passes, each one releasable

Each pass is one branch and one PR. Old names keep working until pass 4.

1. **Pass 1: display name.** README, site, CHANGELOG, UI strings, window titles, CLI help text say Ouros. No ids,
   env vars or paths change. Check: `git grep -i metatrooper -- '*.md' site/` lists only history entries
   (CHANGELOG, dated decisions). Risk: none.
2. **Pass 2: aliases in.** One lookup helper reads `OUROS_X ?? METATROOPER_X ?? TROOP_X`; every env read goes
   through it. `ouros` added as a second bin next to `troop`; `troop` prints a one-line "now called ouros" notice
   on stderr and still runs. MCP servers register under both names. Check: the full core, workbench and router
   suites pass with only old names set, then with only new names set.
3. **Pass 3: home and data move.** On start, if `~/.ouros` is missing and `~/.metatrooper` exists, rename the
   folder (one `fs.rename`, same drive), rename `troop.db` to `ouros.db` inside it, and leave a
   `~/.metatrooper/MOVED-TO-OUROS.txt` stub. Same for `.troop/` to `.ouros/` per project, on first open. Never
   copy-then-delete: the db and secrets move as one rename. Secrets use DPAPI keyed on the Windows user, not the
   folder, so they survive the move; prove it in a test (M8-37c). Check: a copied real home starts, sessions and
   settings intact, `troop.db` gone, stub present. Running core must be stopped first; the migration refuses
   while the old core's pipe answers.
4. **Pass 4: repo and folder, then drop the aliases.** Wasif renames the GitHub repo (GitHub redirects old URLs).
   Move `projects/metatrooper` to `projects/ouros` and fix `operators/relocate.py` and the vault references below
   in the same pass. Aliases from pass 2 stay for the compatibility window, then one PR deletes them.

## Vault references to update in pass 4

`CLAUDE.md` (Routing: `node core/cli.ts ping`, `launch claude`), `.claude/skills/{demo-capture,fanout,idea-mine,
launch-research,phone}/SKILL.md`, `meta/scripts/{README.md,guard-agent.py,kit-drift.py,skill-nudge.py}`, memories
that say `troop launch`, and `operators/relocate.py`. 16 vault files outside `projects/` mention metatrooper in all;
re-run `git grep -il metatrooper -- ':!projects'` on the day.

## Name clash (check before pass 1)

- ouros-fiveshot BOARD.html, 2026-10-30: "The name Ouros is taken in the same space: parcadei/ouros (145 stars, an
  agent sandbox runtime) and npm "ouros"." So `ouros` on npm and `@ouros/*` may be unavailable. Run
  `/launch-research` on the name before any package or CLI rename; the display-name pass does not depend on it.

## Proposed defaults (his call)

- Scope: all four passes. Pass 1 alone is safe to do first and on its own.
- Compatibility window: old env vars, `troop` and the MCP names keep working until the first Ouros public release,
  then one PR removes them.

## Not renamed

- Dated history: CHANGELOG entries, decision logs, archived scratch, old memories. They record what it was called.
- metarouter (lives in `router/`, has its own name).

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
