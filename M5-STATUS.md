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
| M5-9 release gate, CI, versioning | CODE DONE | 2f418f0. tests/release.ps1 (parses in Windows PowerShell 5.1; version, whisper and listeners suites run here, full run not done while another agent held ports), tests/version-check.mjs (a changed plugin version exits 1, M5-09b), root package.json 0.1.0, repo plugin 1.0.0 to 0.1.0, CHANGELOG.md, .github/workflows/ci.yml. Review-bar "auto-opens once" already fixed by 03ee4bc (passes 3 of 3 alone) and kill-tree.ts already built by 8df0817. Owed: M5-09a two clean release runs, M5-09c CI green after a push, the installer build (M5-1 adds `npm run dist`) |
| M5-1 to M5-11 | NOT STARTED | Specced in their issue files. M5-2 and M5-7 wait on Wasif's picks first |
| M5-8 S5 secret scan | DONE on m4-harden | Built there as M4-4 by teehee-f8; not rebuilt |
| M5-12 remote MCP | CODE DONE | 5f2aefd, review fixes 252f5fc. Tests by Codex: m5-remote-mcp.test.ts. Workbench install screen shows host and sign-in from `installScreen`; not seen on screen yet |
| M5-13 step 1 importer shape fix | CODE DONE | 2f02def, https refusal 252f5fc. Tests by Codex: m5-importers.test.ts (Linear and GitHub shaped fixtures) |
| M5-13 steps 2 and 3 marketplace and registry importers | CODE DONE | Built by a MetaTrooper agent session (agent/catalogue, 1268e18 to 05a9f7b), review fixes 4b5226f, merged 98d681c. Tests m5-catalogue.test.ts by Codex. Codex and Gemini both rejected the first version (git URL schemes, unpinned local marketplace, symlink escape, loose registry versions); all fixed. Declined: Gemini's engine-id collision finding, because checks() already refused a taken id |
| M5-14 engines as data | CODE DONE | Built by a MetaTrooper agent session (agent/engines, a351749, 1a07a5f); review fixes 4b5226f (malformed engine files skipped, built-in wins a cost_rank tie). opencode, copilot, gemini, pi engine files. Tests m5-engines.test.ts by Codex |
| Full suites on main fa828e2 | PASS (one load flake) | 2026-10-10T00:15+11:00, after a stuck 22:30 suite was stopped: core 475 tests, 465 pass, 1 fail, 9 skipped; the one failure is M1-06 (window read and pipe latency p95), which passes alone twice, so it is a timing flake under full-suite load. Workbench 224 tests, 165 pass, 0 fail, 59 skipped (opt-in Electron suites) |
| M5-16 issue trigger | NOT STARTED | M5 work after 12-01; re-scored by the Codex gate before building |
| M5-15 notification sink | CODE DONE, UI OWED | d800127, 508a3d7, 252f5fc, 8a915d2. Tests by Codex: m5-notify.test.ts (18 across the three files). No settings pane and no `metatrooper://` handler yet, so a sink is added over the pipe only |
| M5-17 launch hardening | CODE DONE | 11 items, one commit each (9618c9f to d3961d9), review fixes 6e1afa5. Tests: m5-hardening.test.ts by Codex; the S3 test in agy-driver.test.ts and the fixture fixes in loop-handback, e2e-browser-qa and pipelines-m2 (M4-21) by Claude after Codex's sandbox failed twice |
| M5-18 catalogue cut | CODE DONE | 2b05060, tests 12ab0e5 by Codex (catalogue-cut.test.ts) |
| M5-6 Pro review and fix loop | CODE DONE, REAL RUN OWED | f0ef719, a09fe95, 1ea33e6; review fixes f3f0479 (freeze step, runner allow-list, no proof from a timeout or a missing module, index reset, line-drift mapping); c0d8e3d (exact-byte restore, NODE_TEST_CONTEXT stripped). Tests m5-06-pro.test.ts 14 pass, by Codex with fixture fixes by Claude. Codex and Gemini both rejected the first version; every agreed finding is fixed. Declined: removing the checked-out worktree (the hand-back asks the user to commit there) and stripping the proof command's environment (the fix agent already runs with the same user environment). M5-06d, the real run with him on screen, is owed |
| M5-21 preview hardening | CODE DONE | 26 fixes on m5-hp-a/b/c, listed in issues/m5-21-preview-hardening.md; tests m5-21-preview-a/b/c.test.ts by Codex (7 + 7 + 8, two desktop cases skip without a real window) |
| M5-19 one instruction file | CODE DONE, MERGED | See the teehee-c1 section below (02d3aea) |
| M5-4 logs, M5-8 S1 + S3 | CODE DONE, MERGED | See the teehee-c1 section below (6f91031, 7e48720) |
| M5-8 S2 + S5 (m5-8b) | CODE DONE, no code change | 2026-10-10T20:40+11:00. S2: the browser pipe is created by the same `server.listen` as the core pipe, so it has Node's default DACL, read on 36cbc0b: full access for the owner, SYSTEM and Administrators, read only (FR) for Everyone and Anonymous. Only those three can write, which is the bar `pipe-acl.test.ts` holds the core pipe to; Node has no option to drop the Everyone read entry without native code. `tests/windows/m1-10-pipe-acl.ps1` already covers `metatrooper-browser`. Not added to `pipe-acl.test.ts`: `browser/server.ts` imports `panes.ts`, which imports electron, so the browser pipe can only be checked in an Electron run (Codex). S5: M4-20 passes on 36cbc0b (secrets-scan.test.ts 11 pass, real gitleaks); pr-review-fix gets the gate through its `review` sub-pipeline |

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

Gathered 2026-10-10T17:10+11:00. Every branch that only needed review and tests is merged; these need his hands, eyes,
money or name. T2 was settled as M5-D16 and the GitHub milestone was created on 2026-10-09.

Trimmed 2026-10-10 on his word ("drop it if not really needed"); everything else is autonomous work.

1. One sitting with the app on screen, at the end: the m4-harden gate card, one spec-to-pr run, the first real
   pr-review-fix run (M5-06d), the M3-01 real runs (data-to-dashboard first), and a glance at the M5-12 install
   screen. Then one workday in the app (UI-01).
2. After the certificate: a Windows 11 VM with Smart App Control on and a fresh standard account (M5-D24, M5-01a).
   DESKTOP-TSA6L47 is Windows 11 Home, so no Hyper-V there.
3. Money and outside contact, once there is a working model: buy the Certum certificate (M5-D23); send the two terms
   questions in `ide-layer-research/m5-terms.md` (M5-D26); the M5-2 and M5-7 picks, Pro repo, Lemon Squeezy (M5-D20).

Dropped: the agy sandbox login (M5-D29); WSL `build-essential` (M5-9 CI on ubuntu-24.04 covers the core suite on
Linux); the Gmail test account and social-scheduler accounts (their pipelines are not launch built-ins, M5-D1, M5-D2);
the Vite site branch (M5-11 builds a plain page); README GIFs move to Claude (demo-capture on the M5-11 seed).

## teehee-c1 branches, merged 2026-10-10T17:00+11:00

M5-4, M5-8 S1 + S3 and M5-19 were built by teehee-c1 on their own branches and merged to main (6f91031, 7e48720,
02d3aea) after tests, mutant runs and a Codex plus Gemini review of each. Money items (M5-7, the paid signing pick in
M5-2) wait until a working model exists (Wasif, 2026-10-09).

| Child | Status | Evidence / notes |
|---|---|---|
| M5-4 logs | CODE DONE, MERGED | 5629fb1, 4498fb2, 23ebd85. Tests m5-04-logs.test.ts by Codex, 6 pass, 8 of 8 mutants caught |
| M5-8 S1 + S3 | CODE DONE, MERGED | 027353d (S1), 49220af (S3). Tests m5-08-security.test.ts by Codex, 8 pass; fixture fix 50a55fd by Claude (Codex's sandbox could not write the worktree): the extra column now goes first, because a trailing `--` comment on the last column swallowed the appended one. 4 of 5 mutants caught; MISSED: the throw when a column holding data cannot be re-added. The "rebuild failure rolls back" test never triggers a failure (both engines saw it), so that guard is untested |
| M5-19 one instruction file | CODE DONE, MERGED | 808a687, 623d468. Tests m5-19-instructions.test.ts by Codex, 10 pass; fix dd54dae by Claude: the in-process launch test left terminal sessions open, so the run never exited (that hang was the "low memory" mutant stall), and the fixture helper cut paths on `/`. 5 of 5 mutants caught. Project bar line not built (screen) |

Suites on main after the three merges (2026-10-10T17:20+11:00): core 498 tests, 487 pass, 2 fail, 9 skipped. M5-14a/b failed
because M5-19 gave the built-in claude engine an `agents_md` field the engine schema did not list; fixed by adding it to
contracts/plugin-manifest.schema.json (engines, instructions and plugins tests 32 of 32 after). M1-25a (npm by name)
passes alone, so it is a load flake like M1-06 and M4-29.

### Reviews of the three branches

| Branch | Finding | Codex | Gemini | Done |
|---|---|---|---|---|
| m5-logs | Masking only knows secrets decrypted in this process | high | high | declined: every route that hands a secret to a plugin or sink goes through `getSecret`, which caches it, so nothing can print a value masking does not know |
| m5-logs | `stamp()` leaves a dangling timestamp after a trailing newline | not found | high | declined: JavaScript's split never returns an empty tail for a zero-width match at the end, checked in node |
| m5-logs | Synchronous mkdir, stat and append on every write | not found | medium | declined for launch: core log volume is low; revisit if a profile shows it |
| m5-security | Rollback test passes without a failure | not found | medium | logged above as a test hole |
| m5-security | An empty column that cannot be re-added is dropped silently | not found | high | declined: by design, only a column holding data blocks the rebuild |
| m5-security | A non-npm `.cmd` or `.bat` now exits 127 with "not on PATH" | not found | low | not fixed: no shell fallback is the point of S3; the message could name batch files |
| m5-instructions | `agentsMdArgs` never reaches a launch | medium | not found | declined: both launch paths pass it (`launch.ts:69`, `:75`) |
| m5-instructions | AGENTS.md existence check missing | not found | high | invalid: Gemini read the worktree while a mutant was applied |
| m5-instructions | Fixture helper cuts paths on `/` | not found | medium | fixed dd54dae |

Found: a run paused on budget (`max_minutes` 5) leaves an agy step whose session already exited at `running` with no
output (run 01M4G9B600PHFJQT28XBXKQF5E, gemini-review).
