# M1 status ledger

Branch m1-autobuild. Status values: TODO | VERIFIED-LINUX | NEEDS-WINDOWS | NEEDS-WASIF. Only mark VERIFIED if the test passes in that iteration.

| Criterion | Status | Evidence / notes |
|---|---|---|
| M1-01 | TODO | Windows-only; needs tests/windows/ script (not yet written) |
| M1-02 | TODO | Windows-only; needs tests/windows/ script (not yet written) |
| M1-03 | TODO |  |
| M1-04 | VERIFIED-LINUX | core/test/sessions-and-hooks.test.ts:event writer without TROOP_SESSION_ID produces no output or row |
| M1-05 | VERIFIED-LINUX | core/test/sessions-and-hooks.test.ts:event writer appends one redacted row and never stores a marker |
| M1-06 | TODO |  |
| M1-07 | TODO |  |
| M1-08a | VERIFIED-LINUX | core/test/core.test.ts:accepted commands re-execute and running commands become -32098 on restart |
| M1-08b | VERIFIED-LINUX | core/test/core.test.ts:gate.resolve and core.stop require ui.hello on the same connection |
| M1-08 | VERIFIED-LINUX | core/test/core.test.ts:queued command executes on restart... (order/300ms/2s parts unchecked) |
| M1-09 | TODO | Windows-only; needs tests/windows/ script (not yet written) |
| M1-10 | TODO | Windows-only; needs tests/windows/ script (not yet written) |
| M1-11 | TODO |  |
| M1-12 | TODO |  |
| M1-13 | VERIFIED-LINUX | core/test/sessions-and-hooks.test.ts:hooks install and uninstall preserve fixture settings and config byte for byte (claude+codex fixtures) |
| M1-14 | VERIFIED-LINUX | core/test/sessions-and-hooks.test.ts:UserPromptSubmit prints one exact comment envelope and marks only delivered comments |
| M1-15 | VERIFIED-LINUX | core/test/plugins.test.ts:M1-15 a plugin engine appears in engine and binds to a role... |
| M1-16 | VERIFIED-LINUX | core/test/plugins.test.ts:M1-16 an action sees only the base variables... + M1-16 a hung action is killed with its child processes at its timeout |
| M1-17 | VERIFIED-LINUX | core/test/plugins.test.ts:M1-17 and M1-25b an imported Claude plugin... |
| M1-18 | VERIFIED-LINUX | core/test/runner.test.ts:M1-18 validates publish gates, publish fanout, and pinned publish engine |
| M1-18a | VERIFIED-LINUX | core/test/runner.test.ts:M1-18a runs a child pipeline with remaining budget... |
| M1-18b | VERIFIED-LINUX | core/test/core.test.ts:project.open uses canonical path sha1 (case-insensitive part needs Windows) |
| M1-19 | VERIFIED-LINUX | core/test/runner.test.ts:M1-19 marks changed approvals stale and refuses non-UI or code gate resolves |
| M1-20 | VERIFIED-LINUX | core/test/runner.test.ts:M1-20 enforces loop max, resumes failed steps... |
| M1-21 | VERIFIED-LINUX | core/test/runner.test.ts:M1-21 stops new steps at max_tokens... |
| M1-22 | VERIFIED-LINUX | core/test/runner.test.ts:M1-22 worktrees + port leases; core/test/browser-ancestry.test.ts:M1-22 ancestors * (pure walk only; real Get-CimInstance ancestry + pane isolation via MCP still unproven, needs Windows or electron test) |
| M1-23 | TODO |  |
| M1-24 | TODO | policy half VERIFIED-LINUX (core/test/browser-policy.test.ts M1-24 *, 7 tests); page-script/evaluate interception in workbench/src/browser untested (try xvfb-run electron test) |
| M1-25 | TODO |  |
| M1-25a | NEEDS-WINDOWS | npm half VERIFIED-LINUX (plugins.test.ts:M1-25a ... npm by name); .cmd half: run tests/windows/m1-25a-cmd.ps1 |
| M1-25b | VERIFIED-LINUX | core/test/plugins.test.ts:M1-17 and M1-25b ... (DPAPI blob part uses METATROOPER_FAKE_DPAPI; real DPAPI needs Windows) |
| M1-25c | VERIFIED-LINUX | core/test/runner.test.ts:M1-25c shows a dev_command variant only after readiness and discard kills its tree |
| M1-26 | TODO |  |
| M1-27 | TODO |  |
| M1-28 | TODO |  |
| M1-29 | TODO |  |
| M1-30 | VERIFIED-LINUX | core/test/core.test.ts:project.open uses canonical path sha1 and refuses work/ACU |
| M1-31 | TODO |  |
| M1-32 | TODO |  |

## Child issues
#1 core: mostly present (53 core tests, 3 skipped); #3 plugins done (13 tests, 1 skipped .cmd); #2 callrouter not started; #4 runner tested (tests by Codex); #5 workbench exists (4 tests, 1 skipped); #6 browser exists, tests missing; #9/#10/#11/#31/#13 unaudited.

## Log
- 2026-09-30: iter 3. Created ledger. Fixed core suite: corePipe() and test helper pipePath() now use unix sockets under os.tmpdir() off Windows (Windows pipe names unchanged). core 53 tests: 50 pass, 0 fail, 3 skipped. workbench 4 tests: 3 pass, 1 skipped. Codex not used this iteration. Next: audit #3/#4 against issues/ and write runner tests (try codex for tests).
- 2026-09-30: iter 4. Codex wrote core/test/runner.test.ts (7 tests, M1-18..22, 25c) and extended fake-engine.js; no src changes. core 62 tests: 59 pass, 0 fail, 3 skipped. workbench (use `npm test`; bare `node --test` hangs by scanning node_modules) 4: 3 pass, 1 skipped. Next: audit #3 plugin system (M1-15..17), then #6 browser tests (M1-22 pane ancestry, M1-23..25b).
- 2026-09-30: iter 5. Audited #3: plugins.test.ts passes (12 pass, 1 skip). Marked M1-16/17/25b VERIFIED, 25a NEEDS-WINDOWS (added tests/windows/m1-25a-cmd.ps1). core 62: 59 pass, 3 skipped. Tests not new this iteration. Next: #6 browser tests (M1-23..25, M1-22 pane ancestry; use codex).
- 2026-09-30: iter 6. Codex wrote core/test/browser-policy.test.ts (7) and browser-ancestry.test.ts (3); no src changes. core 70 tests: 67 pass, 0 fail, 3 skipped. workbench 4: 3 pass, 1 skipped. Next: #6 electron/xvfb test for panes, cursor overlay (M1-23), evaluate/page-script interception (M1-24), full-page capture (M1-25); write tests/windows script for M1-09.
