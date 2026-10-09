# M5-4 Logs a user can send with a bug report

Child of Milestone 5 in `spec.md`. Tag: BLOCKER (ships 2026-12-01). Effort 0.5 CC days.

## Current state, verified 2026-10-09

`core/src/paths.ts:29-30` defines `~/.metatrooper/logs`; only `event-errors.log` is written
(`core/src/hook/event.ts:42-44`). `core/src/main.ts:28` handles only `'warning'`. The window spawns the core with
`stdio: 'ignore'` (`workbench/src/main.ts:620`), so a core crash leaves nothing behind.

## What to build

- Core stdout, stderr, `uncaughtException` and `unhandledRejection` go to `logs/core.log`; workbench main-process
  errors to `logs/workbench.log`. Rotate at 5 MB, keep 3. Every line passes through `core/src/redact.ts`.
- Ctrl+K "Open logs folder".
- No crash upload (no telemetry).

## Acceptance criteria

- M5-04a. A core started by the window and killed by a thrown error leaves the stack in `logs/core.log`.
- M5-04b. A secret value stored in the DPAPI store and printed by a test plugin never appears in `logs/`.
- M5-04c. Writing 6 MB of log lines leaves at most 3 rotated files of at most 5 MB each.
