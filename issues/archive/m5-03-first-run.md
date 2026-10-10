# M5-3 First run, engine messages, safe default approval

Child of Milestone 5 in `spec.md`. Tag: BLOCKER (ships 2026-12-01). Effort 1.0 CC days (0.5 + 0.25 + 0.25).

## Current state, verified 2026-10-09

- Launch buttons are disabled when an engine light is red (`workbench/renderer/app.js:915`, `:957`, `:1049`,
  `:1347` "(not ready)"); light rule in `workbench/src/queries.ts:30-33`; "Check engines" at `app.js:1445`.
- `core/src/engines/health.ts:64` gives one string for every failure: "not installed or version check failed".
- `core/src/settings.ts:15` defaults `approval` to `contained`, so a new user's first claude runs with
  `--permission-mode auto` and codex with `--approve-for-me` (D41).

## What to build

1. Empty state on the wall when no engine is green: one card per built-in engine with its install command, its
   login command, and Check again.
2. `health.ts` splits the failure into `missing` (not on PATH), `too-old` (version below the registry's
   `min_version` when set), `not-logged-in` (auth command non-zero), `timeout`; each maps to a one-line fix shown
   on the light's tooltip and in the empty state.
3. Default approval for a new settings file becomes `ask` (M5-D6). First run shows one choice: "Ask before each
   tool call (recommended)" or "Auto mode in MetaTrooper worktrees". An existing `settings.json` keeps its value,
   so Wasif's setting does not change.

## Acceptance criteria

- M5-03a. With `PATH` holding no engine, the wall shows three engine cards and no launch button is enabled.
- M5-03b. A fake `codex` whose `login status` exits 1 shows `not-logged-in` and the fix line `codex login`.
- M5-03c. A missing `~/.metatrooper/settings.json` produces `approval: "ask"`; an existing file with `contained`
  keeps `contained`.
