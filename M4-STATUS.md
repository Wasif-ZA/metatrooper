# M4 status ledger

Branch m4-harden, from main at be777d9 (main merged in again at ebaa2ff). Started 2026-10-08 on Wasif's instruction,
unfinished work first. Status values as in M1-STATUS.md. Tests by Codex unless a row says otherwise. Codex's sandbox has
no npm and no Electron, so the Electron and npm tests it wrote were run here, and their fixture faults were repaired by
Claude; each repair is named in its commit.

Waiting on Wasif: code-review-graph install (M4-3), gitleaks install and its Smart App Control result (M4-4), the two
real before-runs in tests/replay/REAL-RUNS.md (M4-1, M4-04), the TOON payloads (M4-5), and a look at the run screen
before m4-harden lands on main.

## Children

| Child | Status | Evidence / notes |
|---|---|---|
| M4-1 replay harness | DONE, real runs owed | 2026-10-08T23:53+11:00: ff19e5c, 6cd0253, 08a2760. Fixture is axios v1.7.2 (decided 2026-10-08: the 10-line spec-to-pr fixture cannot show a saving). baseline.json: small 366, medium 2,820, large 11,200 tokens. tests/replay/token-replay.test.mjs 2 pass, 1 skip (after mode needs code-review-graph). real-before.json not recorded (Wasif). Codex flagged that large.patch is one guard function pasted into 12 files, which may flatter a code map; consider real axios commits before M4-03 is measured |
| M4-2 clean suites | CORE DONE, workbench blocked by a main failure | 2026-10-09T01:00+11:00 on b174a12 (main e4b7515 merged in): core run alone twice back to back, 356 pass 0 fail 7 skipped each, tests/windows/listeners.ps1 count=0 after each. Workbench with both E2E flags: 210 pass; review-bar "a disagree and critical result auto-opens once" times out at 30 s on main 88070e4 as well, so it is not from M4. Two M4 regressions found and fixed on the way: the UI harness did not copy a pipeline's code folder (03539f6), and the run log stopped showing the spec at approve-spec once spec-lint sat between them (b174a12). tests/helpers/kill-tree.ts not built: the suites leave no listeners without it |
| M4-3 code map | NOT STARTED | needs code-review-graph installed (Wasif) |
| M4-4 secret scan | NOT STARTED | needs gitleaks installed and its Smart App Control result (Wasif); waits on M4-2 |
| M4-5 TOON | NOT STARTED | needs the dependency added and three real --json payloads captured by Wasif (they hold his session data) |
| M4-6 OSC probe | DONE | 1299346. claude, codex and agy emitted no OSC 9/99/777 under ask in 120 s, so no terminal change. The probe does not confirm each engine reached its prompt |
| M4-7 fixes from real use | DONE except F3 Continue | 1ba8339, 1890212. F1 9/9 pass (fixture fixes by Claude). F2 covered by M2-03 "discard keeps status ... succeeds on retry after release" (m2-harden, held-open folder); the M4 lock-based test was dropped in the 88070e4 merge because discard now deletes a locked worktree's folder. F3 URL regex test skips on Windows (stub vercel cannot be launched by the deploy script's lookup); Continue case skipped (no Continue path found). F4, F5a, F6, F7 fail on the old code and pass on the new. F5b moot under D51 |
| M4-8 issue amendments | DONE | ede5945. 12 issues and the spec.md Dependencies table; each unbuilt pipeline lists 3 or 4 helpers |
| M4-9 helper tools | DONE | 0e9a510, 0a81dfd. 18 helpers (the issue table names 20 slots, 18 distinct tools). Registry moved to pipelines/assists/registry.json because every .json in pipelines/ loads as a pipeline. M4-14 to M4-18 tests pass; M4-15 semgrep case flaked once under load, passes alone |
| M4-10 mined ideas | DONE except I3 | d3e3fbf, b8f8495, b4fb39e. I1, I2, I4, I5, I6, I8 built with tests (M4-19, M4-21, M4-22, M4-23, M4-24 pass; M4-25 skips without difft). I3 is M4-4's scan step. I8 found resolveCommand could not read the current npm.cmd, so npm ci could never start on Windows; fixed for every caller |
| M4-11 session glue | NOT IN SPEC | issues/m4-11-session-glue.md exists but is not in the spec.md children table and has no effort; not built |
