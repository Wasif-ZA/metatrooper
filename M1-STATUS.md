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
| M1-16 | TODO |  |
| M1-17 | TODO |  |
| M1-18 | TODO |  |
| M1-18a | TODO |  |
| M1-18b | VERIFIED-LINUX | core/test/core.test.ts:project.open uses canonical path sha1 (case-insensitive part needs Windows) |
| M1-19 | TODO |  |
| M1-20 | TODO |  |
| M1-21 | TODO |  |
| M1-22 | TODO |  |
| M1-23 | TODO |  |
| M1-24 | TODO |  |
| M1-25 | TODO |  |
| M1-25a | TODO |  |
| M1-25b | TODO |  |
| M1-25c | TODO |  |
| M1-26 | TODO |  |
| M1-27 | TODO |  |
| M1-28 | TODO |  |
| M1-29 | TODO |  |
| M1-30 | VERIFIED-LINUX | core/test/core.test.ts:project.open uses canonical path sha1 and refuses work/ACU |
| M1-31 | TODO |  |
| M1-32 | TODO |  |

## Child issues
#1 core: mostly present (53 core tests, 3 skipped); #3 ?; #2 callrouter not started; #4 runner exists (tests by Claude when added); #5 workbench exists (4 tests, 1 skipped); #6 browser exists, tests missing; #9/#10/#11/#31/#13 unaudited.

## Log
- 2026-09-30: iter 3. Created ledger. Fixed core suite: corePipe() and test helper pipePath() now use unix sockets under os.tmpdir() off Windows (Windows pipe names unchanged). core 53 tests: 50 pass, 0 fail, 3 skipped. workbench 4 tests: 3 pass, 1 skipped. Codex not used this iteration. Next: audit #3/#4 against issues/ and write runner tests (try codex for tests).
