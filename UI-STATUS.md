# UI revision status ledger

Branch ui-revision, from m2 at b256909 (D20). Started 2026-10-02T20:28+10:00. Epic: issues/archive/ui-revision-epic.md,
children issues/archive/33 to 38 (live stubs for 33, 35, 36, 38 in issues/). Status values as in M1-STATUS.md, plus NEEDS-WASIF for a render pick. Nothing filed on
GitHub; filing and pushing are Wasif's.

| Criterion | Status | Evidence / notes |
|---|---|---|
| UI-01 workday in the app | TODO | needs layout-shell to zero-setup-tools and a real day of use |
| UI-02 first agent in 30 s | TODO | needs installer and a fresh Windows account |
| UI-03 survives the window | VERIFIED-WINDOWS | 2026-10-03T16:44+10:00: workbench/test/ui-revision.test.ts UI-03 (by Codex, opt-in METATROOPER_UI_REVISION_E2E=1). It failed 2 of 2 on this box: the reopened window jumped from line 190 to 218 and showed 218 twice. Fixed in workbench/renderer/terminal.js: a snapshot now resets through the write queue (ESC c) instead of term.reset(), which ran ahead of output still queued from an earlier attach. 3 of 3 pass after; the double attach itself was not observed directly. Earlier: real Electron (scratch ui03.ts): engine prints a line every 100 ms, window killed at line 151, reopened 10 s later: session still `working`, the reattached terminal's last 200 rows equal the core's headless rows (aligned on the window's last line, 251). Test owed |
| UI-04 fewer clicks | VERIFIED-WINDOWS | 2026-10-03T22:13+10:00: workbench/test/ui-revision.test.ts `UI-04 home jobs meet click baselines and improve at least three` (by Codex, opt-in METATROOPER_UI_REVISION_E2E=1) clicks through each job over CDP and checks it completed: start agent 1/1, approve gate 1/1, see diff 0/2, hand back 1/2, open browser 1/2 (measured/baseline), so none worse and 3 better. Earlier: new counts below: 1,1,1,1,1 against today 1,1,2,2,2, so none worse and 3 better. Counted by hand from 01367bb; not screen-recorded. Check reworded 2026-10-02 (Wasif): no job worse than today, at least 3 of 5 better |
| UI-05 no wt or herdr left | VERIFIED-WINDOWS | grep re-run 2026-10-02T22:10+10:00 returns nothing;  2026-10-02T20:40+10:00: the grep returns nothing (exit 1). Migration uses an allow-list so it needs no herdr literal |
| UI-06 core kill to Resume | VERIFIED-WINDOWS | Codex tests pass 2026-10-02;  scratch c35-check.ts against a real core: SIGKILL core, restart, session exited in under 12 s; Resume passes resume_args with the native id (`--`, `resume-with`, `native-1` seen by the engine), same folder; an engine without resume_args gets Start new here (resumed false). Test owed to Codex |
| UI-07 prompt typed once | VERIFIED-WINDOWS | Codex tests pass 2026-10-02;  smoke: no-prompt_arg engine, paste-prompt written then `already written`, one core.prompt-written, zero handoff gates; test owed to Codex |
| UI-08 spec-to-pr step list | VERIFIED-WINDOWS | 2026-10-03T16:44+10:00: workbench/test/ui-revision.test.ts UI-08 x2 (by Codex, opt-in). Earlier: real Electron with a real spec-to-pr run on its fixture (scratch steps-check.ts): list shows step 5 of 6 with each step's status, the approve-pr gate inline with Approve and Reject; a run whose build wrote failed shows `build 1 fail · failed` and its error under it with no click. Test owed |
| UI-09 four result panes | VERIFIED-WINDOWS | 2026-10-03T16:44+10:00: workbench/test/ui-revision.test.ts UI-09 (by Codex, opt-in). Earlier: real Electron, a 4-step pipeline on tests/fixtures/result-panes with the fake engine (scratch panes-check.ts): Review set, Document (score, parts, markdown, sources), Rows and Findings tabs each render their fixture; Approve on clip-1 wrote `approved` into items.json. Test owed |
| UI-10 speed | VERIFIED-WINDOWS | 2026-10-03T22:13+10:00: workbench/test/ui-revision.test.ts (by Codex, opt-in): six live grid terminals at 200 lines/s, keystroke echo median 0.5 ms, p90 0.8 ms over 30 samples (limit 50); a 10,000-row snapshot parsed in the window in 89 ms (limit 500). Suites after: core 143 pass 0 fail 3 skipped, workbench with E2E 20 pass 0 fail 4 skipped. Run them alone: under load from a second Electron run, UI-03, M1-07 and M1-11 time out or drop rows, and failed runs leave test Electron processes behind. Earlier: echo with 6 grid tiles each getting 200 lines/s: median 1 ms, p90 2 ms, max 3 ms of 50, from termInput to xterm.js parsing the echo (paint adds at most one frame, about 16 ms); window attach (pipe to xterm.js write callback) 14 to 23 ms in real Electron; core attach, 10,000 rows (733 KB snapshot): median 44 ms of 10 (min 42, max 53), pipe connect to snapshot parsed. xterm.js write half and 6-tile echo need layout-shell |
| UI-11 tests on the terminal module | VERIFIED-WINDOWS | 2026-10-02: core 126 pass, 3 skipped, including Codex's 18 cases in core/test/terminal.test.ts, inbox-resume.test.ts, migration.test.ts; workbench 9 pass. Earlier note: | core 108 pass, 3 skipped (M1-03 superseded by UI-06, 2 opt-in); workbench 9 pass, 4 opt-in skipped; no test spawns wt.exe. New terminal-core tests owed to Codex (usage limit until 21:31) |
| PORT-A core wall | VERIFIED-WINDOWS | 2026-10-05T15:38+11:00: 73b656f wall port, ed44fa8 workbench/test/wall.test.ts (by Codex, opt-in) 6 pass 0 fail, run alone under the Electron lock, and 6 of 6 on two earlier back-to-back runs: Ctrl+B opens and closes the list, Ctrl+K focuses search and Enter runs the item, waiting sessions get attn and the NEEDS YOU count matches needsCount(), a done session folds to a 36 px bar, Approve from the gate sheet records approval and shows the verdict, default look is dither and charcoal from search persists to settings. UI-04 click baselines pass on 73b656f (run alone). 61604eb adds runDetail; rundetail.test.ts 9 pass 1 skipped (symlink case needs admin on Windows; the junction case covers the escape) |
| PORT-B layout picking | VERIFIED-WINDOWS | 2026-10-05T15:38+11:00: 8641cc6 run screen in five layouts. workbench/test/layout-rules.test.ts (by Codex) 5 pass: step hints pick each step's layout, a failed step picks run-log ahead of its hint, a manual pick holds until 0, a running step is eligible at 5 s, automatic moves wait 2 s after a touch. workbench/test/run-screen.test.ts (by Codex, opt-in) 2 pass, run alone: the spec-to-pr run opens on pr-first at approve-pr and approves the gate; a failed build opens on run-log with its error, keys 1 to 5 switch, 0 restores auto, Esc returns to the wall |
| PORT-C background bar | CODE DONE | bf1ff8e: bar, open rule, five review layouts, review-bar and review-rules tests by Codex. Ledger row updated 2026-10-07. phase C. Check: two-engine-review fixture stays folded with no findings, opens to duel on a Disagree |
| PORT-D product layouts | CODE DONE | 2026-10-07T15:58+11:00: all four slices built. spec-build-review-handback 54ef31d, 3735c52 (hand-back layout); website-build 4ee347c (preview-stage, before-after); design-variants eec8159 (variants-grid); e2e-browser-qa 645d11d (timeline, findings in coverage-map and before-after, findings.json via runDetail). Rule tests by Codex: loop-rules 7, site-rules 7, variants-rules 7, qa-rules 13, rundetail 13, plus loop-handback 3, two-engine-review-diff 2, validation 1, all pass run alone; run-screen and review-bar Electron suites 2 and 2 pass. Not built: pictures of the site (needs screenshot save_to into the run folder), the worktree-rail variant of agent-split, the hand-back bar staying orange until every item is ticked. Never run end to end on a real pipeline. |
| PORT-E M3 pick rules | CODE DONE | 2026-10-07T22:05+11:00: rules for all 11 M3 pipelines in workbench/renderer/layouts/rules.js, flags read from step outputs by flagsOf (f75b6a2). Rule tests by Codex: workbench/test/m3-rules.test.ts 60 pass. Plugin tests by Codex: core/test/m3-plugins.test.ts 14 pass, 1 skipped (PDF export needs Chrome). Codex and Gemini reviewed the plugins; the fixes Wasif picked are in 3b59781. Not done: gmail and social-scheduler (accounts), end-to-end runs (M3-01). |

## M3 progress

The remaining project: Phase E plus children #32 to #27. One row per pipeline; plugin column names the plugin it needs.
Rule inputs beyond step status: `run.paused_why === 'loop-max'` and the pipeline's `data` flags `flag`,
`breaking_no_doc`, `licence_conflict`, `high_reachable`, `unsourced`. Nothing produces those flags yet; each plugin
or step that should is noted in its row. 2026-10-07T21:10+11:00: flags now reach the rules: `layoutRules.flagsOf(runDetail)` reads them from any step's outputs (a non-empty `flags` or `flags_left` list sets `flag`); the run screen and the background bar both pass it in.

| Pipeline | Rule | JSON | Fixture | Rule tests | Plugin | End to end |
|---|---|---|---|---|---|---|
| footage-to-edit (#32) | done | done | done | pass | media probe, transcribe (whisper.cpp base.en, CPU, word times): done | TODO |
| clips-to-scheduled-posts (#33) | done | done | done | pass | media download (yt-dlp), transcribe, cut (9:16), captions (ASS, hook): done; social-scheduler: done on Postiz (self-hosted is free; POSTIZ_URL and POSTIZ_API_KEY secrets), batch refused whole on one bad post, checked with a fake API; live post needs a Postiz instance on an always-on machine (the box, not the laptop: Postiz itself posts at the slot time) and platform keys | TODO |
| seo-audit-fix (#34) | done | done | done | pass | seo crawl: done; fetches refuse private addresses | TODO |
| deep-research-cited (#35) | done | done | done | pass | cite-check check, agent-reach search: done (search saves page text, else the Exa excerpt) | TODO |
| prospect-list-to-drafts (#36) | done | done | done | pass | agent-reach sources: done; gmail draft: TODO (account) | TODO |
| inbox-triage-drafts (#36) | done | done | done | pass | gmail: TODO (account); schedule row not in JSON | TODO |
| data-to-dashboard (#37) | done | done | done | pass | data load, query, render: done on node:sqlite. qa and build are agent steps, so their `uses` is not run | TODO |
| study-notes-to-pdf (#38) | done | done | done | pass | docs-export ingest (pdftotext, text only, no page images) and export-pdf (headless Chrome or Edge): done; unsourced flag from check | TODO |
| docs-and-release-notes (#26) | done | done | done | pass | github list-prs: done, checked live; release: done, not run (external); breaking_no_doc flag from map | TODO |
| form-fill-batch (#39) | done | done | done | pass | desktop screenshot, submit, read (UI Automation, click fallback): done; checked on a test form | TODO |
| security-review-and-upgrade (#27) | done | done | done | pass | security list-deps (npm only), licence-report (sets licence_conflict): done; high_reachable from plan. review-prompts and upgrade are on agent steps, not built | TODO |
| template gallery (#40) | n/a | n/a | n/a | n/a | n/a | Pipelines tab Templates panel on `template.list` (2026-10-09T03:00+11:00); real-window look owed on Windows |

| Child | Status | Notes |
|---|---|---|
| terminal-core | CODE DONE, TESTS OWED | 48d3ab1 code, 9f2bc1d docs. Codex tests owed. herdr #28 closed 2026-10-08 |
| layout-shell | CODE DONE, SUPERSEDED | superseded 2026-10-05 by issues/ui-port-epic.md (layout A gives way to the wall). 01367bb; rounds done: A, themes (default graphite), row 4 |
| status-and-notifications | DONE | tests by Codex 2026-10-02 (core/test/inbox-resume.test.ts); inbox, done/failed rows, read/unread, toast, Clear status, Resume; checked by script and in the real window |
| zero-setup-tools | DONE | 2026-10-03T16:44+10:00: core/test/ui-revision.test.ts (first-launch setup, shells) and the Ctrl+K Electron case, by Codex; file drop not testable from CDP; engine setup on first launch, shell tabs from settings, pipelines in Ctrl+K, drop files on a terminal |
| step-list | DONE, SUPERSEDED | superseded 2026-10-05 by issues/ui-port-epic.md (the step list becomes the run-log layout). 2026-10-03T16:44+10:00: Electron cases by Codex. Codex found Save wrote a schema-invalid pipeline over the valid file; fixed in workbench/renderer/app.js (validate first, save only when valid), test now passes; step list (e74a9d8) and editor restyle: collapsed rows, one open form, drag to reorder, JSON view and validation kept |
| result-panes | DONE | 2026-10-03T16:44+10:00: item-set and turn_base core cases, UI-09 and D15 Electron cases, by Codex; four panes, run.item-set, fixtures. D15 Diff toggle built: Last turn (git stash create at each turn start, stored as session.turn_base; your stash list is untouched), Uncommitted, Whole branch (merge-base with origin/HEAD, main or master); checked by scratch turn-check.ts. The visual half of the widened Diff is the Browser tab's Before/After compare |

## Click counts (today, before layout-shell)

Counted from the m2 code (b256909), home = Sessions tab with a project open. A click is one mouse click or key chord.

| Job | Today | Path |
|---|---|---|
| Start agent | 1 | engine button in the Launch toolbar; a Windows Terminal window opens |
| Approve gate | 1 | Approve in the always-visible Gates rail |
| See diff | 2 | Hand-back tab, then a file chip |
| Hand back | 2 | Hand-back tab, then Copy |
| Open browser | 2 | Browser tab, then New pane (1 if a pane exists) |

New counts (01367bb): start agent 1 (New claude in the rail; the new terminal is selected), approve gate 1 (rail),
see diff 1 (Diff in the terminal header; 0 when the Diff tab is already open), hand back 1 (Hand back in the
header), open browser 1 (Browser tab opens a pane when none exists).

Start agent and approve gate are already 1, so "each lower" could not hold. Wasif chose 2026-10-02: no job worse than today, at least 3 of the 5 better.

## Decisions

- 2026-10-02: dependencies for terminal-core are node-pty 1.1.0, @xterm/headless and @xterm/addon-serialize. All MIT. Under
  the 25k star gate; accepted by D7 (xterm.js 21,240 stars, node-pty 2,040 stars, nothing better passes). The two
  @xterm packages are the xterm.js monorepo. They go in core only, never in the workbench package.
- 2026-10-02: `pwsh` (PowerShell 7) is not installed on this laptop. Shell tabs fall back to `powershell.exe` (5.1)
  when `pwsh` is missing.

- 2026-10-02: nothing hardcoded (Wasif). Terminal values live in core/src/settings.ts DEFAULTS and are overridden
  by `~/.metatrooper/settings.json` under `terminal`: cols, rows, scrollback, font_family, font_size, background,
  foreground, border, chunk_bytes, slow_viewer_bytes, bell_silent_ms, prompt_wait_ms. A wrong-typed key keeps its
  default; broken JSON means all defaults. Read on each use with an mtime cache, so edits apply without a restart.
- 2026-10-02: an interim terminal view (workbench/renderer/terminal.js, xterm.js 6.0.0 + fit 0.11.0, MIT, D7)
  shows the selected session under the old Sessions tab until layout-shell's layout replaces the page around it. CSP
  style-src gains 'unsafe-inline' because xterm.js writes its own style elements.

- 2026-10-02: Ctrl+K one-click actions run pipelines, not raw plugin actions, so external actions keep their
  approval gates (the pipeline runner is the only path that enforces them). A plugin action becomes one-click by
  being a pipeline step.
- 2026-10-02: shell tabs come from settings.terminal.shells (command plus fallback); here pwsh is missing, so
  PowerShell is powershell.exe 5.1, plus Git Bash. Shell tabs are not session rows and live in the window's memory.
- 2026-10-02: first launch of an engine from the app installs its hooks (state_source hooks) or notify wrapper
  (notify) and its settings once, recorded in hooks-install.json `setup`; the launch result names the files and
  the window toasts them. Drag-and-drop of files onto a terminal types quoted paths without Enter; not driven by a
  test (Electron cannot synthesise a file drop from CDP without a real file list).

## Log

- 2026-10-02T20:35+10:00: Task 0 of terminal-core PASSED on the first path (prebuilt binary). node-pty 1.1.0 ships
  win32-x64 prebuilds; it loaded under Node 24.18.0 even with npm's allow-scripts blocking its install script.
  Proof script (scratch, not in repo): spawn `powershell.exe` through ConPTY, `echo hello-$(1+1)` echoed
  `hello-2`, resize to 120x40 read back as 120, `exit 7` gave exit code 7, @xterm/headless serialize() held the
  output. 1.4 s end to end.
- 2026-10-02T20:40+10:00: terminal-core code landed (48d3ab1). Terminal module, term pipe, launch through pty, prompt typed
  on first idle, session.focus to ui_selection, schema v2 migration checked against a v1 database built from the
  old schema.sql, term.* events. Killing a pty owner hard took the launcher and engine with it (both gone in 7 s),
  so M1-03 was skipped as superseded by UI-06, then deleted once Codex's case 9 covered UI-06. node-pty prints "AttachConsole failed" from its console-list helper
  when a pty is killed; noise only, the kill works.
- 2026-10-02T20:44+10:00: docs (9f2bc1d): spec.md D19, D32, Rule 1, Launching; terminal pipe contract (attach
  carries the ui key, a decision made here: typing into an agent is as strong as approving a gate).
- 2026-10-02T20:50+10:00: layout-shell round 1 research started (layout references).
- 2026-10-02T21:05+10:00: real Electron check (scratch wb-check.ts): fake engine printing a line every 100 ms,
  session.focus, the window shows `line 33` to `line 37`, attach to xterm.js write callback 23 ms. Window killed,
  10 s later reopened: same session reattached in 17 ms showing `line 134` onward, so the agent kept running.
  After the settings change: 15 ms and 14 ms. Core 108 pass, workbench 9 pass.
- 2026-10-02T20:55+10:00: layout-shell round 1 board ready at ~/.cache/claude-scratch/metatrooper-ui-revision-2026-10-02/renders/round1/board.html
  (5 structures A to E from 13 surveyed tools, research-layouts.md beside it). Waiting on Wasif's pick.
- 2026-10-02T20:57+10:00: round 1 pick: A (session list, big terminal, side split with tabs). Round 2 varies material (colour and type) on A.
- 2026-10-02T20:59+10:00: round 2 pick: every material is a user-selectable theme (graphite, paper, terminal, slate, light); graphite is the default. Values from round2/gen.py MATS.
- 2026-10-02T21:05+10:00: round 3 pick: session row 4 (engine, task, time; branch with +/-; last output line, amber when asking). Render rounds done; layout-shell code may start. Brief: layout A + 5 themes (default graphite) + row 4.
- 2026-10-02T21:28+10:00: layout-shell first pass landed (01367bb): layout A, themes, row 4, grid, palette, first screen,
  Diff tab on the selected agent's changes. Real Electron via CDP: single, grid, palette, paper theme and first
  screen screenshots checked by eye; new agent is selected on launch; Browser tab opens a pane. Opt-in browser
  e2e (M1-22, M1-23 to 25) pass with the pane inside the split. Core 108, workbench 9.
- 2026-10-02T22:05+10:00: Codex wrote the terminal-core/#35 tests (18 cases, 3 files) in a separate worktree; it stopped on a
  model-capacity error before its final run. I ran them: 125 of 126 passed. Case 6 found a real bug: after
  slow-viewer the pipe called end(), the next output write hit the ended socket, the write error destroyed it and
  the queued slow-viewer frame was lost; and the snapshot itself counted toward the limit, so a big snapshot could
  trip slow-viewer on every reattach. Fixed in core/src/terminal/pipe.ts (no writes after end; the limit counts
  bytes beyond the snapshot). 126 of 126 now. Codex did not run its break-the-line checks.
