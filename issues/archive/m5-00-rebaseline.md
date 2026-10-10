# M5 re-baseline: every undone item from M1 to M4 now lives in M5

Child of Milestone 5 in `spec.md`. Written 2026-10-09 from a read-only audit of main `ace0783`. Wasif, 2026-10-09: every undone issue
or spec item goes into M5 (launch). So no item below belongs to M1, M2, M3 or M4 any more. BLOCKER rows must ship by
2026-12-01 and are owned by an M5 child (spec.md, Milestone 5 children). M5 rows are M5 work done after the
2026-11-05 freeze opens up again, in the order of this file; M5 closes only when they are done or cut.

## Every open item from M1 to M4, tagged

Tags: BLOCKER (ships 2026-12-01, owned by an M5 child), M5 (M5 work after 12-01), CUT (dropped from the plan), FROZEN (kept as is, no new work). M3-01 real runs of the 10 preview pipelines are M5 rows because those pipelines ship as preview (M5-18).

### Ledger rows that look open but are not (do not count)

- `issues/26-docs-and-release-notes.md:34` and `27-security.md:34` M2-01 unchecked; M2-STATUS.md:12 VERIFIED-WINDOWS.
- `issues/29-usage-limits-and-accounts.md:19` M2-05 unchecked; M2-STATUS.md:16 VERIFIED-WINDOWS.
- `issues/sandbox-host.md:29,30,32` M2-09, M2-10, M2-12 unchecked; M2-STATUS.md:20-21,23 VERIFIED-WINDOWS (M2-10 live typed marker stays open below).
- UI-STATUS.md:50 terminal-core "TESTS OWED"; UI-STATUS.md:19 UI-11 says Codex's 18 cases landed 2026-10-02.
- Harden plan P1 "no-network hook misses the Electron main process": done in ace0783 (workbench/test/no-network.test.ts:26).
- M1-03, M2-04: SUPERSEDED.
- status-and-notifications, zero-setup-tools, result-panes: DONE (UI-STATUS.md:52, :53, :55); the live stubs only own the code under the wall.

### M1 and adoption gate

| Item | Tag | Reason |
|---|---|---|
| M1-01 `npm run dev` under Smart App Control | M5 | Users get the signed installer (M2-07, LAUNCH); the dev path matters for contributors only |
| M1-10 second-user half (`tests/windows/m1-10-pipe-acl.ps1`) | BLOCKER | Pipe access is the boundary that stops another account approving gates; 10 minutes of his time |
| M1-10 gap: browser pipe ACL | BLOCKER | Same default DACL drives panes and has no test (L24) |
| A-01 native_id coverage | M5 | Dogfood metric for his own use; real users replace it after launch |
| A-02 status asks | M5 | Same |
| A-03 smoke-test runs | M5 | Same |
| A-04 pasted screenshots | M5 | Same |
| A-05 toolrouter 20% saving | M5 (cut only on Wasif's word: it overrules his 2026-10-05 goal) | Measured 9.8%; money plan (10-08): savings counters do not sell, never quote it. This overrules his earlier standing memory (2026-10-05) that token saving is a major goal itself, so he must confirm |

### M2 and its issues

| Item | Tag | Reason |
|---|---|---|
| M2-07 / #31 signed installer | BLOCKER | D50: no unsigned release |
| M2-08 agy hands-off isolated (`troop sandbox login agy`) | M5 | Sandbox ships experimental (L30); Pro does not need it |
| M2-10 live typed marker in a sandboxed session | M5 | Hook-level proof exists; live check goes with the sandbox |
| M2-11 close half test and orphan sweep | M5 | Sandbox-only |
| #29 account switcher half | M5 (not built until the vendor terms are read, M5 hand-back) | Money plan section 13: switching between Claude accounts breaks vendor terms |
| #26 docs-and-release-notes real run | M5 | Lane, not part of Pro; label preview |
| #27 security-review-and-upgrade real run | M5 | Same |

### M3 and its issues

| Item | Tag | Reason |
|---|---|---|
| M3-01 footage-to-edit real run (#32) | M5 | Lane outside the launch pitch; label preview |
| M3-01 clips-to-scheduled-posts real run (#33) | M5 | Needs a Postiz instance on an always-on machine and platform keys |
| M3-01 seo-audit-fix real run (#34) | M5 | Lane; label preview |
| M3-01 deep-research-cited real run (#35) | M5 | Lane; agent-reach search step is fake in e2e |
| M3-01 prospect-list-to-drafts real run (#36) | M5 | Needs his throwaway Gmail and OAuth client |
| M3-01 inbox-triage-drafts real run (#36) | M5 | Same; schedule row not in JSON |
| M3-01 data-to-dashboard real run (#37) | M5 | His first pick for a real run, but not part of Pro; do it as alpha dogfood if time allows |
| M3-01 study-notes-to-pdf real run (#38) | M5 | Lane; label preview |
| M3-01 form-fill-batch real run (#39) | M5 | Lane; WinForms and Win32 forms unreadable (harden plan P1) |
| M3-01 docs-and-release-notes, security-review-and-upgrade | M5 | Counted above under #26, #27 |
| M3-04 / #40 template gallery UI | M5 | `template.list` works; screen needs three design rounds |
| M3-05 / #41 Tauri tray | CUT (M5-D10) | Deferred by him; adds Rust and a second signing target for a window the plan says does not sell |
| M3-06 / #42 tray half | CUT (M5-D10) | Moot if the tray is cut; core and workbench half done |
| PORT-E gmail and social-scheduler rules | M5 | Wait on accounts |
| Gmail real-account wiring | M5 | Same |

### M4

| Item | Tag | Reason |
|---|---|---|
| M4-1 real before-runs, M4-01 baseline real half | M5 | Token saving is a standing goal but not a launch claim |
| M4-03 replay gate (median ratio at most 0.70) | M5 | Depends on M4-3; no launch claim rests on it |
| M4-04 real after-runs | M5 | Same |
| M4-2 workbench half and `tests/helpers/kill-tree.ts` | BLOCKER | Release gate needs clean suites (L29). kill-tree helper landed on main in 8df0817 (2026-10-09); the workbench half still owes two clean runs |
| M4-3 code-map plugin (M4-05, M4-06) | M5 | Needs code-review-graph installed; agy attach not verified |
| M4-4 publish-gate scan (M4-07, M4-08) | M5 | Publish gates already need a click |
| M4-4 before external send (M4-20) | BLOCKER | Pro sends every diff to OpenAI and Google (L25) |
| M4-5 TOON (M4-09) | CUT (M5-D10) | Opt-in behind a 15% flip rule, needs his private payloads, nobody asked for it |
| M4-6 probe confirmation (harden P1) | CUT | No engine emits OSC 9/99/777; rerun only if one announces support |
| M4-7 F3 Continue row | M5 | Small test gap; code path not found |
| M4-11 session glue (M4-26 to M4-32) | M5 | Not in the spec table, about 2 CC days; a good retention feature for January |
| M4-12 / UI-01 one workday in the app | BLOCKER | Cheap real-use bug hunt before 100 people see it |

### UI and UI port

| Item | Tag | Reason |
|---|---|---|
| UI-02 first agent within 30 s on a fresh account | BLOCKER | The clean-machine install (L4) |
| PORT-C check (review folds, opens to duel on Disagree) | BLOCKER | It is the Pro screen; review-bar test fails on main (L29) |
| PORT-D pictures of the site (screenshot save_to) | DONE | Landed on main in bb1b45f (2026-10-09, PR #48) |
| PORT-D worktree-rail variant of agent-split | DONE | Landed on main in 14cb178 (2026-10-09, PR #48) before the freeze rule; kept, no further work (M5-D3) |
| PORT-D hand-back bar stays orange until every item is ticked | DONE | Landed on main in 14cb178 (2026-10-09, PR #48) |
| PORT-D never run end to end on a real pipeline | BLOCKER | Covered by L28 for the Pro loop |
| Live-text cards never seen in the running app | BLOCKER | Part of UI-01 and his look at m4-harden |

### Harden plan items not already tagged above

| Item | Tag | Reason |
|---|---|---|
| P0 sandbox one-engine review | M5 | Sandbox ships experimental (L30) |
| P0 orphan containers after core crash | M5 | Same |
| P0 image and proxy allow-list drift | M5 | Same |
| P0 schema rebuild drops unknown columns | BLOCKER | Data loss on upgrade for every user |
| P0 `shell: true` fallback, `core/src/hook/launch.ts:43-46` | BLOCKER | Runs for every unresolved launch, not only sandbox; quoting cmd does not honour (`%VAR%` expands, command name unquoted) |
| P0 gmail plus safe-fetch light review | BLOCKER (safe-fetch), M5 (gmail) | safe-fetch ships in four plugins; gmail waits on its real account |
| P1 safe-fetch DNS rebinding ceiling | M5 | Marked ponytail, accepted ceiling |
| P1 D6 shared `.git` refs | M5 | Record as known; sandbox-only |
| P1 Claude token expiry mid-run warning | M5 | Sandbox read-only logins only |
| P1 one script for all opt-in suites | BLOCKER | Release gate (L29) |
| P1 plugins.test.ts install-approval flake | M5 | Did not recur in two clean runs (inputs.md item 11) |
| P1 spool close test, commit M2-08 driver | M5 | Sandbox |
| P1 audit Codex's blind npm and Electron tests; real large.patch | M5 | Six already repaired; replay is not a launch claim |
| P1 deploy URL test skips on Windows | M5 | Lane polish |
| P1 two ptys running docker hang | M5 | Sandbox |
| P1 hooks never in daily use (dogfood week H3) | BLOCKER | Same as UI-01; state bugs show only in real use |
| P1 desktop plugin vs WinForms and Win32 | M5 | Lane |
| P1 whisper and desktop e2e skip silently | M5 | Lane tests |
| P1 pipelines cannot run sandboxed | CUT | Nobody asked; the Pro loop runs in worktrees on the host |
| P1 Codex broker holds a worktree cwd | M5 | Discard retry already works |
| P2 rerun M1-07 600 s, M1-21 mixed sizes, M1-12 fresh fixtures | M5 | Regression checks, no known bug |
| P2 dead skips (core.test.ts:314-315, m3-plugins.test.ts:324) | M5 | Cleanup |
| P2 drop `session.title`, `session.last_line` | M5 | Unused columns, harmless |
| P2 about 16 stale troop worktrees | M5 | His local disk only |
| P2 record known limits | BLOCKER | Goes in README (L11) so nobody files them |
