# M3 status ledger

Branch m3-harden, from main at 4752228 (2026-10-08). Status values as in M1-STATUS.md. Unfinished criteria first,
then each issue (#32 to #42) is re-read and hardened one at a time.

M3-01 is checked in two halves, and only both together tick it:

- Wiring: the built-in runs on a fake engine with its real plugin actions on its real fixture input, reaches every
  gate with the guarded step not run, and finishes on approve. This proves the runner, gates and plugin actions fit,
  not that an agent does the job.
- Real run: the same fixture through real engines, with Wasif on screen. Listed under "Real runs".

Fixture inputs live in `tests/fixtures/<pipeline>/input/`. `run.js` next to them is only screen mock data.

| Criterion | Status | Evidence / notes |
|---|---|---|
| M3-01 | IN PROGRESS | Wiring tests in core/test/m3-e2e.test.ts (by Claude). data-to-dashboard WIRING 2026-10-08T23:00+11:00: real `data/load` on input/orders.csv (20 orders over two weeks with a duplicate, DD/MM dates, `$` prices, a blank region and a blank qty) into raw, row count and columns checked against the file, every agent step done in order, pauses at the signoff handoff gate, done on approve. Dev command swapped for a node server so the test needs no `npx` download. seo-audit-fix WIRING 2026-10-08T23:00+11:00: five audit lanes, fix in a worktree, speed loop, pauses at approve with guards_step deploy and an action hash, vercel never called before approve and called once with `--prod` after. Since 2026-10-08T23:15+11:00 the real `seo/crawl` runs against input/site (3 pages served on loopback, seeded faults: an image without alt, two pages without a meta description, two h1 on one page, a link to a missing page) and the test checks the 404 is the one broken link. deep-research-cited WIRING 2026-10-08T23:06+11:00: pauses at approve-plan before any search; the fixture sources (input/sources, two texts and sources.json) are copied in at the gate; real `cite-check` binds both quotes of a correct report and the run ends done; with one planted figure it fails that quote, the patch loop runs twice and the run pauses at loop-max. Search is a fake step because `agent-reach/search` needs Exa over the network. study-notes-to-pdf WIRING 2026-10-08T23:11+11:00: real `docs-export/ingest` (pdftotext) splits input/lecture.pdf (3 slides, printed from input/lecture.html) into 3 page files, real `export-pdf` (headless Chrome) writes the notes PDF, pauses at the signoff handoff gate, done on approve. form-fill-batch WIRING: see M3-03. footage-to-edit WIRING 2026-10-08T23:30+11:00: input/takes holds two takes (23 s and 17 s, 320x180, 380 KB together) made from Windows speech synthesis over an ffmpeg test pattern; take-01 has a false start for the edit to cut. Real `media/probe` and real whisper `media/transcribe` (72 words, both takes) run before the approve-plan gate; edit has not run at that gate; done after approve-final. Skips when whisper.cpp is missing. The spec's 3-minute video is cut to 40 s to keep the repo small. clips-to-scheduled-posts WIRING 2026-10-08T23:43+11:00: real `media/download` (local file), whisper `transcribe`, `cut` and `captions` on take-01; at the pick gate nothing is cut; the test marks one of three moments approved (as the user would) and continues; exactly one clip is cut and styled; the approve gate guards schedule; a local fake Postiz (secrets set through `plugin.secret.set`) gets no call before approve and exactly integrations, upload, posts after. inbox-triage-drafts WIRING 2026-10-08T23:53+11:00: a local fake Gmail serves input/mailbox.json (a VIP ask, a noreply invoice carrying a prompt-injection line, one sent thread with no answer); the real `rules` code step copies input/rules.md; real `gmail/read` writes both messages with their bodies and the one follow-up; the approve gate guards drafts and Gmail gets no POST before it; after approve one draft is saved in thread t1 with In-Reply-To set. prospect-list-to-drafts WIRING 2026-10-08T23:53+11:00: the real `load` code step keeps 2 of input/prospects.csv's 5 rows and drops no email, a case-only duplicate and a do-not-contact address; approve-spend guards the site fetch (a fake external step, since `agent-reach/sources` needs the network); four hook lanes; approve guards drafts; after approve 2 new drafts (no thread) are saved. Gmail runs against the fake through `TROOP_GMAIL_API` (Wasif's pick, 2026-10-08T23:53+11:00): honoured only for 127.0.0.0/8 or ::1, refused otherwise, so the refresh token cannot leave the machine. WIRING DONE for all 11 built-ins; M3-01 stays open until the real runs below. |
| M3-02 | VERIFIED-WINDOWS | c271cff: core/test/m3-plugins.test.ts cite-check planted-quote and curly-quote cases. |
| M3-03 | VERIFIED-WINDOWS | 2026-10-08T23:27+11:00: core/test/m3-e2e.test.ts, opt-in `METATROOPER_DESKTOP_E2E=1` because it opens two real windows for about 12 s. Fixture: input/form.ps1, a WPF form (Name, Email, Postcode, a Captcha group with an answer box, Submit, a status line) and input/rows.csv (2 rows). The fake fill agent types each row into its window by handle; the run pauses at the captcha handoff gate for each row (paused_why handoff, summary says captcha shown); the test types the captcha answer and continues; real `desktop/screenshot` saves both windows; the approve gate guards submit and submit has not run; after approve real `desktop/submit` presses Submit in both and real `desktop/read` returns "Received: Ada Byron" and "Received: Alan Turing". Also the form-fill-batch half of M3-01. |
| M3-04 | IN PROGRESS | 2026-10-08T23:06+11:00: 17 templates in `pipelines/templates/` (Wasif's pick: a subfolder, so `store.ts`, which reads only `pipelines/*.json`, never seeds them as runnable). Catalog 3, 4, 5, 9, 15, 16, 18 to 22, 24, 25 and A1 to A4; all 17 pass `validatePipeline` against the real plugin manifests. 13 name future plugins in `requires` (tts, video-gen, social-posts, sheets, cms, chat, calendar, tasks, keyword-data, search-console, answer-engines, youtube, image-gen), so they never show ready until those exist. 2026-10-08T23:58+11:00: `template.list` (core/src/pipelines/store.ts `listTemplates`, pipe-protocol.md) returns all 17 with `requires`, `missing` and `ready`, ready only when every required plugin is installed and enabled. core/test/template-gallery.test.ts: the 17 ids match the files, missing and ready agree with the plugin table, disabling one required plugin flips that template to not ready, and no template becomes a runnable `pipeline` row. Left: the gallery in the workbench. |
| M3-05 | DEFERRED | 2026-10-09T00:03+11:00, Wasif's pick: no Rust or Tauri install now; the workbench already shows every session state and gate. Revisit with the signed installer (#31), which the tray ships with. The tray half of M3-06 waits with it. |
| M3-06 | PARTIAL | 2026-10-08T23:57+11:00, core/test/open-core-seams.test.ts (by Claude). Refusals: `session.launch` of a gateway engine, and `run.start` of a pipeline with `run_in: cloud` or a step pinning a gateway engine, all return -32040 with the session, run, run_step and gate counts unchanged and no run folder; role binding skips gateway engines even at the lowest cost_rank. Removing the launch check and the bindRole filter fails both tests. Account state: new `account.state` method answers `{state: "signed_out"}` (pipe-protocol.md); nothing prompts for sign-in. No network, Wasif's pick: core/test/no-network-hook.mjs is loaded with --import into the core and every Node child (checked: main.ts, pty workers, launch.js, the engine, event.js all load it) and logs any TCP connect or DNS lookup to a non-loopback host; a full fake-engine spec-to-pr run through both gates logs nothing. Left: the workbench half (Electron main process) and the tray, which does not exist yet (M3-05). |

## Real runs

- data-to-dashboard on input/orders.csv with a real engine: his pick for the first one; needs him on screen.
- The other 10 on their fixture inputs, one at a time, with him on screen.
- inbox-triage-drafts and prospect-list-to-drafts against a real test Gmail account (his to create, with an OAuth
  client); his pick on 2026-10-08T23:53+11:00: loopback fake for wiring now, the real account for this run.

## Hardening notes

- FIXED 2026-10-09T00:09+11:00, #33: `max_clips` was a number with no maximum while `cut` and `style` fan out to a fixed 4, so 6 dropped
  clips 5 and 6. It is now a `choice` of 1 to 4 (no schema change); run.start refuses 6 (m3-e2e clips test) and
  m3-plugins checks the largest choice equals the fan-out.
- FIXED 2026-10-08T23:15+11:00, #27 #34 #35: the runner writes an action step's result to `<run_dir>/<step id>.json` (contract,
  pipelines.md). Three built-ins wrote their own data to that same name, so the runner's `{ok, outputs}` file
  replaced it: seo `crawl.json` (the audit lanes got counts, not pages), security `inventory.json`, and cite-check's own
  `cite-check.json`. Renamed to `site-crawl.json`, `deps.json` and `quote-check.json` (also the `seo-content` template).
  `validatePipeline` now refuses a `with` value of `{{run.dir}}/<action or code step id>[-n].json`
  (core/test/result-file-clash.test.ts).
- DONE 2026-10-08T23:15+11:00, #34, Wasif's pick B: `seo/crawl` may fetch loopback only when the start URL resolves to loopback
  (all of 127.0.0.0/8, ::1, IPv4-mapped); a public start never reaches loopback, by link or redirect; other private
  ranges stay refused either way. Resolved addresses are checked, not names. core/test/seo-loopback.test.ts, one case
  per refusal path; making loopback always allowed fails 3 of its 6 tests.
- #38: the `outline` prompt says the slides folder holds "one page image per slide", but `ingest` writes text only.
- #39: the captcha handoff gate pauses on every row, also when fill reports `captcha: none`. Gates have no condition
  field, so a batch of 20 rows with no captcha still stops 20 times.
- #39: `desktop.ps1` loads managed UI Automation only. A classic WinForms or Win32 form then shows every control as
  `Pane` with no patterns: edit boxes are indistinguishable from labels in `read`, and Submit is pressed by a mouse click
  at its position. The first fixture form was WinForms and hit this; it is WPF now. Apps with native UIA (WPF, browsers,
  UWP) work.
- FIXED 2026-10-09T00:08+11:00, Wasif's pick: a loop `until: steps.X.passed` treated a missing `passed` as passed, so an agent that
  forgot the key ended its check loop as if it passed. Now only `passed: true` (or "true") passes; a missing one repeats
  the loop and pauses at loop-max (runner.ts evalUntil, pipelines.md amended, core/test/loop-passed.test.ts; the old
  line fails it). Used by deep-research-cited, footage-to-edit,
  security-review-and-upgrade, seo-audit-fix and study-notes-to-pdf.
- FIXED, #33: `cut` read the moments file from `{{steps.moments.outputs.items}}`. An agent that sets it to a relative
  `moments.json` (the test's first fake did) made every cut fail with ENOENT, because actions resolve paths from the
  project folder. `cut` now reads `{{run.dir}}/moments.json`, the path the prompt fixes.
- FIXED 2026-10-09T00:09+11:00, #32 #33: `media` `pickMoment` fell back to every moment when none was approved, so dropping all of them
  at the pick gate still cut the first 4. A dropped moment is now never cut; with no approved moment the pending ones
  are cut as before (core/test/pick-moment.test.ts; the old line fails it).
