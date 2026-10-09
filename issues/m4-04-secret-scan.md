# M4-4 Secret scan at publish gates and before external sends

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

Child of Milestone 4 in `spec.md` (Milestones and child issues). Decisions M4-D1 to M4-D12 and the
verified current state are there; this file is what to build.

## What to build
- Base commit: `placeIndex` writes `<run_dir>/worktrees/<step>-<idx>.base` containing the project HEAD
  sha read just before `git worktree add`.
- Scan function `scanForSecrets(run, worktree, base, label)` in a new `core/src/pipelines/secrets-scan.ts`:
  1. In the worktree: `git add -A -N`, then `git diff <base>` written to `<run_dir>/scan-<label>.diff`.
  2. `gitleaks stdin --redact --no-banner --exit-code 1 --report-format json --report-path <run_dir>/scan-<label>.json`
     with the diff on stdin, 60 s timeout, process tree killed on timeout.
  3. Exit 0: `{"status":"clean","count":0}`. Exit 1 and a parsable report: `{"status":"findings","count":N,
     "items":[{"rule","file","line"}]}`, where `file` and `line` come from mapping each finding's
     `StartLine` in the diff back to the nearest preceding `+++ b/<file>` header and hunk line numbers.
     Anything else (not on PATH, spawn error such as Smart App Control, timeout, other exit code,
     unparsable report): `{"status":"unavailable","reason":"<one line>"}`.
  `--redact` keeps secret values out of the report; `items` never contain a `Secret` or `Match` field.
- Publish gates, order of events: in `gateStep`, when no gate is waiting and the guarded step has role
  `publish`, the scan runs first and synchronously (at most 60 s), and its result is written in the same
  `INSERT` that creates the gate (`scan` column). The gate is never created without its scan, and a scan
  never updates an existing gate. The scan target is the worktree of the most recent step in the run with
  `worktree: true`, with that step's `.base`, label `gate-<gate id>`; a run with no worktree step stores
  `unavailable`, reason "no worktree to scan". The scan is not part of `action_hash` (the hash still binds
  the action, M1 rule). If the gate goes stale (`checkApproval`, `runner.ts:786`), the new gate it creates
  runs a fresh scan the same way. Reject behaves as today.
- Before external sends: `two-engine-review` gets a code step `scan` after `diff` that scans `review.diff`
  the same way and outputs `status` and `count`. The next step is a gate step `send-check` (`gate: approve`,
  no `guards_step`, so `action_hash` is null like every plain approval today) with a new step field
  `"when": "{{steps.scan.outputs.status}} == findings"`: the runner skips a step whose `when` is false
  (status `skipped`). The gate's summary lists the findings; its `scan` column holds the scan JSON, so the
  override rule below applies. Reject cancels the run. `when` supports only `==` and `!=` between a
  template and a literal; `pipeline.validate` refuses anything else.
- Schema: `gate` gains `scan TEXT` (the JSON above) and `override_reason TEXT`, both nullable, added at open
  by `ALTER TABLE` when missing (the `db.ts:33` pattern) and written into `contracts/schema.sql`.
- `gate.resolve` gains `override_reason?: string`. When `scan.status` is `findings` and `decision` is
  `approve` and `override_reason` is missing or blank after trimming, it refuses with -32602 "this gate has
  secret-scan findings; approve needs override_reason". The reason is stored on the row.
- Workbench: the gate card (rendered for `ui.snap.gates`) shows the items and replaces Approve with
  "Approve anyway" plus a reason box when `scan.status` is `findings`, and a red line "Secret scan did not
  run: <reason>" when `unavailable`. The Ctrl+K "Approve:" quick action (`app.js:877`) is not offered for a
  gate with findings.
- `tests/windows/m4-gitleaks-sac.ps1`: runs `gitleaks version`, prints `allowed` or the error, so the
  Smart App Control result is recorded in this section once known.

## Acceptance criteria

- M4-07. spec-to-pr on a fixture branch with a planted fake AWS key (`AKIA` plus 16 characters from the
  gitleaks test set): the `approve-pr` gate has `scan.status = findings`; `gate.resolve` approve without
  `override_reason` returns -32602; with a reason the run proceeds and the row holds the reason; no file in
  `<run_dir>` and no database row contains the key's 16 characters.
- M4-08. With `gitleaks` removed from PATH, the gate shows `scan.status = unavailable` and approve works
  without a reason.
- M4-20. With the fake key in the reviewed diff, the "Send this diff" gate opens and neither engine step
  starts until it is approved with a reason.

## Tests

| Criterion | Test | Kind |
|---|---|---|
| M4-07, M4-08, M4-20 | `core/test/secrets-scan.test.ts` with a fake `gitleaks.cmd` for exit codes, plus one case with the real binary skipped when absent | unit and integration |

Tests by Codex. A test that needs a real external tool skips with a printed reason when it is absent.
