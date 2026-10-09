# M4-7 Fixes from real use

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

Child of Milestone 4 in `spec.md` (Milestones and child issues). Decisions M4-D1 to M4-D12 and the
verified current state are there; this file is what to build.

## What to build
Each row is done when a test fails without its fix and passes with it.

| Id | Fix | Pass condition | Source |
|---|---|---|---|
| F1 | The "selected owner" and "grid mode" cases in `workbench/test/needs-you-runbox.test.ts` fail on fixture setup | both cases pass with `METATROOPER_UI_REVISION_E2E=1` | commit 16158f2 |
| F2 | Discard's "worktree survived" error path | a test makes `git worktree remove` fail and asserts the variant keeps its status and `variant.discard` returns an error | M2-STATUS M2-03 |
| F3 | Tests for the four Gemini-review fixes in M2-01 (`serve: "before"`, deploy `.vercel` copy, handoff needs_you cleared on Continue, URL by regex) | one test each | M2-STATUS M2-01 |
| F4 | "Latest row" queries ordered by local-time text | `grep -n "ORDER BY .*at" core/src` results all order by `rowid` or a UTC column; a test inserts two rows across the April DST hour and gets the newer | 2026-10-02 finding |
| F5a | A pipeline agent session in `waiting_for_you` raises nothing | in the wait loop (`runner.ts:646`), the first time the step's session is `waiting_for_you`, `needsYou('other', <session id>, "<pipeline> / <step>: <engine> is waiting for an answer")`, once per session; the run's bar opens. The row gets `resolved_at` when the session leaves `waiting_for_you`, when the step ends for any reason, or when the run is cancelled; it is raised again only after it was resolved and the session returns to `waiting_for_you`. Test with the fake engine writing a blocked activity line | run 01M454ZKZD9VF9BGKG54PMXM2S, `build` on agy, blocked 15:29:29, gone 15:30:05 |
| F5b | That `build` step ran `agy` without the claude driver | a test always proves an agy agent step launches `claude` with `driven_engine = 'agy'` when claude is usable, and logs `driver unavailable` and launches `agy` when it is not; the cause for that run (from its `log.jsonl`) is recorded in this row | same run |
| F6 | An exit with no output names nothing | the `runner.ts:670` error becomes "<step>: the session exited (last state <state> for <n> s) without writing <path>", using the session's last state and how long it held | same run |
| F7 | No CLI cancel | `troop run cancel <run id> [--json]` calls `run.cancel {run_id}`, prints `cancelled <run id>` or `{}` with `--json`, exit 0; an unknown run prints the RPC error, exit 1 | same run |

Intake: while M4 is open, each problem found in real use is appended as the next F row with the date, the
run or session id, and a pass condition.

## Acceptance criteria

- M4-11. Every F row in M4-7 meets its pass condition.

## Tests

| Criterion | Test | Kind |
|---|---|---|
| M4-11 | one test per F row, files named in the row | mixed |

Tests by Codex. A test that needs a real external tool skips with a printed reason when it is absent.
