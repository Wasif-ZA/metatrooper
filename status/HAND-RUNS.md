# Hand runs still owed (M7-20)

Every run that needs a person, a real window, his accounts or a second Windows PC, grouped by the machine it needs. Written 2026-11-24 for M7-20a.
An item is ticked only with a dated result (ISO date, machine, commit, what was seen) in its status ledger (M7-20b): the ledger named in Closes, or the issue file when no ledger is named.

App start on this laptop, used below as "start the app" (README.md:118-126):
`node core/cli.ts start`, `node core/cli.ts ping`, then `cd workbench && npm run dev`.
Daily copy, used below as `daily.sh`: `~/.cache/claude-scratch/ouros-daily/daily.sh` (verbs `promote`, `start`, `stop`, `status`, `rollback`).

## 1. This laptop

| Criterion | Issue file | Exact steps | Closes |
|---|---|---|---|
| M4-11 on Windows | issues/archive/m4-11-session-glue.md | 1. `cd core && node --test test/session-owners.test.ts` 2. `cd workbench && node --test test/gitpane.test.ts` 3. Start the app, open two sessions that edit files, look at the outside tile and the Git groups in the real window. | M4-11 (status/M4-STATUS.md:28) |
| UI-01 a workday in the app | issues/archive/ui-revision-epic.md | 1. Use the app for one calendar day. 2. Pass when `session` rows with `host = 'pty'` cover at least 6 h that day and no `~/.claude/history.jsonl` prompt that day has a `sessionId` missing from `session.native_id`. Query: steps: see issues/archive/ui-revision-epic.md:244 (core/src/gate.ts). | UI-01 (status/UI-STATUS.md:11) |
| M6-26b window closed at 3,000 ms | issues/m6-26-wall-repairs.md | 1. Start the app with a done tile. 2. Click hide on it. 3. Close the window about 3 s later, before the 7 s Undo runs out. 4. Reopen: no `session.hide` was sent, the session is not hidden. Steps: see issues/m6-26-wall-repairs.md:65. | M6-26b |
| M6-26e Ctrl+R reaches the pty | issues/m6-26-wall-repairs.md | 1. Start the app, open a shell tile. 2. Press and release Alt: focus stays in the tile. 3. Press Ctrl+R: the window does not reload and the shell gets it (bash reverse search prompt shows). | M6-26e (issues/m6-26-wall-repairs.md:68) |
| M7-01f parked pane keeps viewport width | issues/m7-01-browser-tools-v3.md | 1. Park a browser pane. 2. Force a `dbg.detach()`. 3. The pane still reports width 1280 (`PARKED_VIEWPORT`). Steps: see issues/m7-01-browser-tools-v3.md:73 and :101. | M7-01f |
| M7-01f laptop DevTools check | issues/m7-01-browser-tools-v3.md | Result already recorded: pass, 2026-11-08, Electron 44.4.5 (issues/m7-01-browser-tools-v3.md:128). 1. Start the app, press F12 in a browser pane. 2. DevTools opens docked at the bottom of the tile. | M7-01f (last bullet, :104) |
| M6-18d agent cursor, two displays | issues/m6-18-agent-cursor-for-browser-and-desktop.md | Needs a second monitor (one at 100%, one at 150%). 1. Grant Notepad, have an agent click a control. 2. Drag the window to the other display, click again. 3. Screenshot both, measure cursor tip to control centre (pass within 3 px). 4. Record date, both scales and the error. Steps: see issues/m6-18-agent-cursor-for-browser-and-desktop.md:124. | M6-18d |
| M9-01a save and git diff | issues/m9-01-file-save-search-and-close-guard.md | 1. Start the app, open a tracked file. 2. Change one line, Ctrl+S. 3. In a shell pane: `git diff`. 4. Pass: only that line. | M9-01a |
| M9-02a Ctrl+P opens a file | issues/m9-02-ide-editor-screen.md | 1. Start the app. 2. Ctrl+P, type part of a file name, Enter. 3. Pass: the file opens in a tab with syntax colours. | M9-02a |
| M9-04a Changes list and diff | issues/m9-04-source-control-view.md | 1. Edit and save a file. 2. Changes lists it with M. 3. Click it: the diff shows the edit. | M9-04a |
| M9-04c Commit from the view | issues/m9-04-source-control-view.md | 1. Stage files, type a message, press Commit. 2. In the shell pane: `git log -1 --stat`. 3. Pass: that message and only the staged files. | M9-04c |
| M9-05a New file | issues/m9-05-new-file-open-outside-open-in-vs-code.md | 1. Ctrl+Shift+P, "New file", type `notes/todo.md`, Enter. 2. `ls notes/todo.md` in a shell pane. 3. Pass: file on disk and open in a tab. | M9-05a |
| M9-05b Open outside | issues/m9-05-new-file-open-outside-open-in-vs-code.md | 1. Click a PDF in the tree. 2. Press "Open outside". 3. Pass: it opens in his PDF app. | M9-05b |
| M9-05c Open in VS Code | issues/m9-05-new-file-open-outside-open-in-vs-code.md | 1. Click a `.tex` file. 2. Press "Open in VS Code". 3. Pass: VS Code opens that project with that file. | M9-05c |
| M9-06a shortcut beside the real app | issues/m9-06-daily-copy-and-promote-gate.md | 1. Start his real MetaTrooper. 2. Double-click the desktop shortcut (runs `daily.sh start`). 3. Pass: Ouros opens, the real one still lists its own sessions. | M9-06a |
| M9-06c folder survives restart | issues/m9-06-daily-copy-and-promote-gate.md | 1. In the daily copy, open a folder with the picker. 2. `daily.sh stop` then `daily.sh start`. 3. Pass: the folder is still listed. | M9-06c |
| M9-06d promote refuses a red build | issues/m9-06-daily-copy-and-promote-gate.md | 1. In the build tree break one test, commit. 2. `daily.sh promote`: prints the failure. 3. `daily.sh status`: old commit. 4. `git revert HEAD` in the build tree. | M9-06d |
| M9-06e rollback | issues/m9-06-daily-copy-and-promote-gate.md | 1. `daily.sh status` (note commit). 2. `daily.sh rollback`. 3. `daily.sh status`: previous promoted commit, app running. | M9-06e |
| M9-06f survives its terminal | issues/m9-06-daily-copy-and-promote-gate.md | 1. In a new terminal: `daily.sh start`. 2. Close that terminal. 3. Pass: the daily copy window stays open (`daily.sh status` shows it running). | M9-06f |
| M9-06g stop leaves nothing | issues/m9-06-daily-copy-and-promote-gate.md | 1. `daily.sh stop`. 2. `tasklist /FI "IMAGENAME eq electron.exe"` and `tasklist /FI "IMAGENAME eq node.exe"`. 3. Pass: none from `ouros-daily`. | M9-06g |
| M9-07a Report issue opens the page | issues/m9-07-report-issue-live-and-daily-triage.md | 1. `daily.sh start`. 2. Press Report issue. 3. Pass: the browser opens a filled new-issue page. Note: the box says `Wasif-ZA/metatrooper-private`, the 2026-11-17 update (line 6) says the public `Wasif-ZA/metatrooper`; the box needs that fix first. | M9-07a |
| M9-07b commit in the body | issues/m9-07-report-issue-live-and-daily-triage.md | 1. `daily.sh status`, note the commit. 2. Compare with the commit in the Report issue body. | M9-07b |
| M10-00 G3(b) fresh clone | issues/m10-00-launch-cc-2026-12-09.md | 1. Into an empty folder run the README source steps (README.md:118-126). 2. Pass: the window opens and `node core/cli.ts ping` answers. | G3(b), M5-09 |
| M10-00 G3(d) re-walk | issues/m10-00-launch-cc-2026-12-09.md | 1. Start the app on the release head. 2. Walk every screen in dark, then light. 3. Pass: 0 blockers. Steps: see issues/m10-00-launch-cc-2026-12-09.md:30. | G3(d) |

## 2. Second Windows PC (or a second Windows account)

| Criterion | Issue file | Exact steps | Closes |
|---|---|---|---|
| M6-00a source install | spec.md:757 | Second PC, Smart App Control on. 1. Start a timer at `git clone`. 2. Run README.md:118-126. 3. Launch a claude agent. 4. Pass: on the wall within 10 min. | M6-00a (spec.md), M7-20 |
| M1-01 dev run under Smart App Control | status/M1-STATUS.md | This laptop has SAC off. On a PC with SAC on: 1. `powershell -File tests/windows/m1-01-dev.ps1`. 2. It prints the SAC state (1 = on) and must pass. | M1-01 (status/M1-STATUS.md:9) |
| M1-10 second-user pipe ACL | status/M1-STATUS.md | 1. Start the core as the owner. 2. As another standard local user: `runas /user:<other> "powershell -File tests/windows/m1-10-pipe-acl.ps1"`. 3. Pass: prints `PASS M1-10`. | M1-10 (status/M1-STATUS.md:20), G3(g) row 7 |
| UI-02 first agent in 30 s | issues/archive/ui-revision-epic.md | 1. New local Windows account with Node 24 and claude CLI logged in (not timed). 2. Install MetaTrooper (installer waits on D72; source install until then). 3. Screen-record from first window to first agent output. 4. Pass: under 30 s, no docs open. | UI-02 (status/UI-STATUS.md:12) |
| M10-00 G3(c) clean PC | issues/m10-00-launch-cc-2026-12-09.md | SAC on, standard account, computer use included. Steps: see issues/m10-00-launch-cc-2026-12-09.md:29 (points at M8-44c, M6-14). | G3(c) |

## 3. Needs his accounts (Claude, Codex, Gemini, opencode, GitHub, sites)

| Criterion | Issue file | Exact steps | Closes |
|---|---|---|---|
| Codex trust spike | issues/m6-05-state-from-each-engine-s-hooks-with-the.md | 1. `echo 'require("fs").writeFileSync("stop-fired.txt", "1")' > hook.js` 2. `codex -c 'hooks.Stop=[{hooks=[{type="command",command="node hook.js"}]}]' "say hi"` 3. Pass: no trust prompt, `stop-fired.txt` appears. 4. Check `hooks.Interrupt` is accepted. Never `--dangerously-bypass-hook-trust`. Steps: see :36-45. | M6-05a, Known limits (spec.md:970) |
| Gemini hook route on Windows | issues/m6-05-state-from-each-engine-s-hooks-with-the.md | Needs a Gemini account that can sign in (free tier refused). He picks one of three routes first (admin-owned folder, extension, or stay on process state). Steps: see :47-64. | M6-05b, Known limits (spec.md:970) |
| Live Claude tool_use_id check | issues/m6-05-state-from-each-engine-s-hooks-with-the.md | 1. In a Claude tile, get a permission wait. 2. Have a different tool call start (PreToolUse). 3. Pass: tile stays `waiting_for_you`, goes `working` on PostToolUse of the waited call. Steps: see :14. | M6-05c, Known limits (spec.md:970) |
| D21 "waiting for your input" capture | spec.md | 1. In a Claude tile, leave it idle until it sends the "waiting for your input" Notification. 2. Capture the raw hook payload (no type). 3. Repeat to show the text is stable. Steps: see spec.md:967. | Known limit (spec.md:967), then M7-20c/d |
| M6-23 subagent Stop | issues/archive/m6-23-true-status-part-2.md | One live Claude tile starts a background subagent; a hook dumps the raw Stop input to scratch. Record real `type` and `status`. Steps: see :40. | M6-23a, report row :122 |
| M6-23 Escape | issues/archive/m6-23-true-status-part-2.md | Record working and idle titles of one live Claude tile and the bytes Escape sends from a wall tile. Steps: see :61. | M6-23c, report row :122 |
| M6-23 opencode session | issues/archive/m6-23-true-status-part-2.md | 1. Spike: does opencode load a plugin by file URL in `OPENCODE_CONFIG_CONTENT` (else `OPENCODE_CONFIG_DIR`). 2. One real opencode session shows `working` and `done` from its plugin. Steps: see :61 and :95. | M6-23e, report row :122 |
| M6-08a Shift+Enter per CLI | issues/m6-08-agent-input.md | In a Claude, a Codex and a Gemini tile: 1. Type a line, press Shift+Enter. 2. Pass: newline inserted, not submitted. Record each CLI version. | M6-08a |
| M9-02j visual judge | issues/m9-02-ide-editor-screen.md | 1. Screenshot the IDE screen. 2. Give it with `research/ref-shots/herdr/06-showcase-layout-code.webp` to Gemini and to Codex. 3. Fix points both raise. | M9-02j |
| M9-07c test issue and triage | issues/m9-07-report-issue-live-and-daily-triage.md | 1. Submit one test issue from the Report issue page. 2. `~/.cache/claude-scratch/ouros-daily/triage.sh` (defaults to `Wasif-ZA/metatrooper`; for the private repo `TRIAGE_REPO=Wasif-ZA/metatrooper-private`). 3. Pass: it lists the issue. | M9-07c |
| M9-09e lent site | issues/m9-09-lent-session-fixes-after-codex.md | 1. In a lent browser session, open a site he uses. 2. Pass: it signs in and loads its own images and scripts. | M9-09e |
| M6-01b pipelines repo and tag | issues/m6-01-split-the-pipelines-out.md | Not ready on 2026-11-24: the repo is not at `teehee/projects/metatrooper-pipelines` and `pipelines-final` is not on origin. 1. Put the repo there. 2. In it: `git log --oneline -- core/src/pipelines/runner.ts` shows pre-split commits. 3. `git push origin pipelines-final`. 4. `git ls-remote --tags origin pipelines-final` prints it. spec.md:762 names `../suite-of-products/shared/core/src/pipelines/runner.ts` instead; settle which. | M6-01b |
