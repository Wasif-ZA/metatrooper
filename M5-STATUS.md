# M5 status ledger

Started 2026-10-09T14:30+11:00 under `/goal` while Wasif was away. Spec: spec.md, Milestone 5. Every undone M1 to M4
item is M5 work now (`issues/m5-00-rebaseline.md`). Status values as in M1-STATUS.md.

All M5 code is on main. Wasif merged m4-harden, m5-launch and the first heads of m5-pro and m5-hp-a/b/c through PRs
#69 to #72 (2026-10-09T21:57+11:00); the later commits on those four branches (Pro review fixes, tests, hp-a's last
fixes) were merged straight into main and pushed at 0a76790.

Suites on main 0a76790 (2026-10-09T23:10+11:00): core 462 tests, 452 pass, 1 fail, 9 skipped
(`METATROOPER_FAKE_DPAPI=1 npm test`); the one failure is M4-29 in session-owners.test.ts (session glue, PR #49),
which passes alone twice, so it is a timing flake under full-suite load. Workbench 224 tests, 165 pass, 0 fail, 59
skipped (the opt-in Electron suites). Not yet: `tests/release.ps1` (M5-9 is not built), Linux (WSL lacks `make`).

GitHub (2026-10-09T21:40+11:00, run with Wasif's go-ahead): milestone "M5 launch" due 2026-12-01; #26, #27, #29,
#31 to #40 and #42 moved into it; #41 closed as not planned; M5-1 to M5-19 filed as #50 to #68 in order (M5-1 is #50,
M5-19 is #68), each pointing at its issue file.

## Children

| Child | Status | Evidence / notes |
|---|---|---|
| M5-0 re-baseline | DONE | 003139e. 16 BLOCKER, 52 M5, 5 CUT, 2 FROZEN rows |
| M5-1 to M5-11 | NOT STARTED | Specced in their issue files. M5-2 and M5-7 wait on Wasif's picks first |
| M5-8 S5 secret scan | DONE on m4-harden | Built there as M4-4 by teehee-f8; not rebuilt |
| M5-12 remote MCP | CODE DONE | 5f2aefd, review fixes 252f5fc. Tests by Codex: m5-remote-mcp.test.ts. Workbench install screen shows host and sign-in from `installScreen`; not seen on screen yet |
| M5-13 step 1 importer shape fix | CODE DONE | 2f02def, https refusal 252f5fc. Tests by Codex: m5-importers.test.ts (Linear and GitHub shaped fixtures) |
| M5-14, M5-16 | NOT STARTED | M5 work after 12-01; re-scored by the Codex gate before building |
| M5-15 notification sink | CODE DONE, UI OWED | d800127, 508a3d7, 252f5fc, 8a915d2. Tests by Codex: m5-notify.test.ts (18 across the three files). No settings pane and no `metatrooper://` handler yet, so a sink is added over the pipe only |
| M5-17 launch hardening | CODE DONE | 11 items, one commit each (9618c9f to d3961d9), review fixes 6e1afa5. Tests: m5-hardening.test.ts by Codex; the S3 test in agy-driver.test.ts and the fixture fixes in loop-handback, e2e-browser-qa and pipelines-m2 (M4-21) by Claude after Codex's sandbox failed twice |
| M5-18 catalogue cut | CODE DONE | 2b05060, tests 12ab0e5 by Codex (catalogue-cut.test.ts) |
| M5-6 Pro review and fix loop | CODE DONE, REAL RUN OWED | f0ef719, a09fe95, 1ea33e6; review fixes f3f0479 (freeze step, runner allow-list, no proof from a timeout or a missing module, index reset, line-drift mapping); c0d8e3d (exact-byte restore, NODE_TEST_CONTEXT stripped). Tests m5-06-pro.test.ts 14 pass, by Codex with fixture fixes by Claude. Codex and Gemini both rejected the first version; every agreed finding is fixed. Declined: removing the checked-out worktree (the hand-back asks the user to commit there) and stripping the proof command's environment (the fix agent already runs with the same user environment). M5-06d, the real run with him on screen, is owed |
| M5-21 preview hardening | CODE DONE | 26 fixes on m5-hp-a/b/c, listed in issues/m5-21-preview-hardening.md; tests m5-21-preview-a/b/c.test.ts by Codex (7 + 7 + 8, two desktop cases skip without a real window) |
| M5-19 one instruction file | NOT STARTED | First step is verifying the Claude Code flag |

## Two-engine reviews

### m5-integrations (d462be7..HEAD), both engines rejected first

| Finding | Codex | Gemini | Done |
|---|---|---|---|
| Restart resends to a sink that already got the row | high | high | fixed: `notify_delivery` table |
| Rows in retry backoff fill the 50-row batch | medium | medium | fixed: backoff rows left out of the batch |
| Webhook follows a redirect to plain http | medium | medium | fixed: `redirect: 'error'` |
| Server id unquoted in `headersHelper` | medium | high | fixed: quoted, and the id pattern added |
| A stdio server with `writes: external` skips the attach rule | not found | critical | fixed: the rule runs before the transport check |
| Importer accepts an `http://` remote | not found | medium | fixed: refused with an error |
| Rows no sink wants are never marked, starving the batch | not found | not found | found by Claude reading the code, fixed 508a3d7 |

### m5-harden (9c31689..HEAD), Codex rejected, Gemini partial

| Finding | Codex | Gemini | Done |
|---|---|---|---|
| An unparseable reject still reads as a clean review | T4 partial | major (F3, F6) | fixed: hand-back item |
| `unplaced` findings never reach the hand-back | not found | minor (F2) | fixed: hand-back item |
| Absolute paths outside the project count as files | P2 | minor (F1) | fixed: they go to `unplaced` |
| check-build crashes without `build-0.base` | P1 (bad base) | major (F9) | fixed: merge-base fallback, named error |
| pytest detection misses nested `tests/`; throws when `tests` is a file | P2 | major (F10) | fixed: three levels deep, no throw |
| `failing` turns from a list into the string `unknown` | not found | major (F12) | declined: `unknown` was already the contract (`runner.ts:610`) |
| CRLF diff puts `\r` into the file name | not found | major (F4) | declined: `.` never matches a carriage return in JavaScript, so the claim does not hold |
| `PORT` overrides a user's own `PORT` | P2 | not found | declined: the ready check watches the allocated port, so the allocated port must win |
| S2 should fail a build that touches no test file | partial | not found | declined: a docs-only build is legitimate; the gate shows "none touching a test file" |
| A foreign process on the port still counts as ready | not found | major (F14) | declined for launch: needs a pid-to-port lookup; the port comes from the lease allocator, so the window is small |
| T5 rename of a file with spaces loses the old name | not found | minor (F5) | not fixed, logged here |

## Repo scan

About 1,640 READMEs read by gemma4:12b at no token cost, relevance checked by Haiku and Sonnet; the last seven lanes finished by Sonnet from search descriptions (GPU stopped on his word). Relevant repos per
pipeline: the four coding built-ins 40 to 43 each (`ide-layer-research/m5-hardening-coding.md`); the 13 others in
`ide-layer-research/m5-repo-scan-preview.md`: 39 to 47 each, except form-fill-batch at 34 (the search pool is generic RPA and captcha tools; not padded).

## Waiting on Wasif

The hand-back in spec.md, Milestone 5, plus: his look at the m4-harden gate card; one spec-to-pr run on screen on
`m5-launch` (check-build is new in the path); T2's meaning of "disagree"; `~/.cache/claude-scratch/metatrooper-m5-2026-10-09/github-m5.sh`
for the GitHub milestone.
