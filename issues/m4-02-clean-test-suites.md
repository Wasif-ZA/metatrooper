# M4-2 Test suites clean up after themselves

Child of Milestone 4 in `spec.md` (Milestones and child issues). Decisions M4-D1 to M4-D12 and the
verified current state are there; this file is what to build.

## What to build
- Every core and workbench test that binds a port or starts a process ends its process tree in `after`:
  `taskkill /PID <pid> /T /F` on Windows, `process.kill(-pid)` elsewhere, through one helper
  `tests/helpers/kill-tree.ts` (new; reused by both suites).
- `tests/windows/listeners.ps1`: lists `Get-NetTCPConnection -State Listen` on 3001 to 3100 whose owning
  process is `node` or `electron`, prints `count=<n>`, exits 1 when n > 0.

## Acceptance criteria

- M4-02. The full core suite, run alone twice in a row, passes, and `tests/windows/listeners.ps1` prints
  `count=0` after each run. Same for the workbench suite.

## Tests

| Criterion | Test | Kind |
|---|---|---|
| M4-02 | the suites plus `tests/windows/listeners.ps1` | Windows |

Tests by Codex. A test that needs a real external tool skips with a printed reason when it is absent.
