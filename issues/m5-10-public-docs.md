# M5-10 Public docs rewritten for the four parts

Child of Milestone 6 in `spec.md` (carried M5 work). Priority: Critical. Effort: 1.0 CC day. Depends on: M6-1, M6-15.
The old-scope issue is `issues/archive/m5-10-public-docs.md`.

## Current state (2026-10-18, main 7a7c26f)

- `README.md` still described the pipeline desk: an installer section, a Pipelines section, a Pro section,
  `troop run` commands, a plugin network table for plugins that moved, and a privacy proof test
  (`workbench/test/no-network.test.ts`) that no longer exists.
- Computer use (M6-15) is merged, with `contracts/desktop-tools.md`. The agent cursor (M6-18) and `--demo` (M6-16)
  are on their branches and land soon; the docs describe them as part of the product.
- `CONTRIBUTING.md` and `SECURITY.md` named pipelines; `CHANGELOG.md` had no summary of M6.

## What to build

1. `README.md` for the four parts (D52) and the source install (D72): what it is; quickstart from source, Windows
   first and Linux beta; the wall; browser use (approvals, origins, secrets, handoff); computer use (grants,
   take-over key, watcher, what it refuses); core services (sessions come back, ports and previews, notifications,
   public API); privacy; known limits linked to `spec.md` and the contracts; the licence map.
2. `CONTRIBUTING.md`: the E2E gates and the rule never to point a test at the real home.
3. `SECURITY.md`: scope is the four parts; the report path is GitHub private vulnerability reporting.
4. `CHANGELOG.md`: an Unreleased summary of M6.

## Acceptance criteria

- M5-10a. `grep -niE "pipeline|installer|troop run|\bPro\b" README.md site/index.html` returns no claim that
  MetaTrooper has pipelines, a paid add-on or an installer. A line that says one of them is absent is allowed.
- M5-10b. Every command in the README runs on Windows from a fresh clone, or is marked as needing a desktop
  session. Checked on 7a7c26f with the core offline: `node core/cli.ts --help` (exit 0), `engines` (exit 0),
  `skills list` (exit 0), `sessions` (exit 0), `ping` (exit 3, "core offline", as the README says). Not run here,
  because they change the real core or need a person: `npm run dev` (needs a desktop), `start`, `serve`, `stop`,
  `launch`, `hooks install`, `browser secret` (asks for a value). The Linux block is not run here.
- M5-10c. Each Known limits link resolves to a heading that exists: `spec.md#known-limits`, `spec.md#threat-model`,
  `contracts/desktop-tools.md#known-limits`, `contracts/approvals.md#known-limits`.

## Hand-back

- Old-scope images in `assets/` (`parts.png`, `pipe.png`, `feat-*.gif`, `wall-demo.gif`, `wall.png`,
  `wall-list.png`) are no longer referenced by the README. Delete them, or replace them with the M5-11 recordings.
