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
| M3-01 | IN PROGRESS | Wiring tests in core/test/m3-e2e.test.ts (by Claude). data-to-dashboard WIRING 2026-10-08T23:00+11:00: real `data/load` on input/orders.csv (20 orders over two weeks with a duplicate, DD/MM dates, `$` prices, a blank region and a blank qty) into raw, row count and columns checked against the file, every agent step done in order, pauses at the signoff handoff gate, done on approve. Dev command swapped for a node server so the test needs no `npx` download. seo-audit-fix WIRING 2026-10-08T23:00+11:00: five audit lanes, fix in a worktree, speed loop, pauses at approve with guards_step deploy and an action hash, vercel never called before approve and called once with `--prod` after. Since 2026-10-08T23:15+11:00 the real `seo/crawl` runs against input/site (3 pages served on loopback, seeded faults: an image without alt, two pages without a meta description, two h1 on one page, a link to a missing page) and the test checks the 404 is the one broken link. deep-research-cited WIRING 2026-10-08T23:06+11:00: pauses at approve-plan before any search; the fixture sources (input/sources, two texts and sources.json) are copied in at the gate; real `cite-check` binds both quotes of a correct report and the run ends done; with one planted figure it fails that quote, the patch loop runs twice and the run pauses at loop-max. Search is a fake step because `agent-reach/search` needs Exa over the network. study-notes-to-pdf WIRING 2026-10-08T23:11+11:00: real `docs-export/ingest` (pdftotext) splits input/lecture.pdf (3 slides, printed from input/lecture.html) into 3 page files, real `export-pdf` (headless Chrome) writes the notes PDF, pauses at the signoff handoff gate, done on approve. form-fill-batch WIRING: see M3-03. Left: footage-to-edit, clips-to-scheduled-posts, prospect-list-to-drafts, inbox-triage-drafts. |
| M3-02 | VERIFIED-WINDOWS | c271cff: core/test/m3-plugins.test.ts cite-check planted-quote and curly-quote cases. |
| M3-03 | VERIFIED-WINDOWS | 2026-10-08T23:27+11:00: core/test/m3-e2e.test.ts, opt-in `METATROOPER_DESKTOP_E2E=1` because it opens two real windows for about 12 s. Fixture: input/form.ps1, a WPF form (Name, Email, Postcode, a Captcha group with an answer box, Submit, a status line) and input/rows.csv (2 rows). The fake fill agent types each row into its window by handle; the run pauses at the captcha handoff gate for each row (paused_why handoff, summary says captcha shown); the test types the captcha answer and continues; real `desktop/screenshot` saves both windows; the approve gate guards submit and submit has not run; after approve real `desktop/submit` presses Submit in both and real `desktop/read` returns "Received: Ada Byron" and "Received: Alan Turing". Also the form-fill-batch half of M3-01. |
| M3-04 | IN PROGRESS | 2026-10-08T23:06+11:00: 17 templates in `pipelines/templates/` (Wasif's pick: a subfolder, so `store.ts`, which reads only `pipelines/*.json`, never seeds them as runnable). Catalog 3, 4, 5, 9, 15, 16, 18 to 22, 24, 25 and A1 to A4; all 17 pass `validatePipeline` against the real plugin manifests. 13 name future plugins in `requires` (tts, video-gen, social-posts, sheets, cms, chat, calendar, tasks, keyword-data, search-console, answer-engines, youtube, image-gen), so they never show ready until those exist. Left: the gallery listing with ready computed from installed plugins, and its test. |
| M3-05 | TODO | Tauri tray. Needs a Rust toolchain; ask before installing. |
| M3-06 | PARTIAL | `run_in: cloud` refused with -32040 (runner.ts:149). `provider: gateway` has the type (registry.ts:25) but no refusal found. Account state and the zero-outbound check not built. |

## Real runs

- data-to-dashboard on a small CSV with a real engine: his pick for the first one; needs him on screen.

## Hardening notes

- #33: `max_clips` has `default: 4` and a "4 at most" label but no maximum, while `cut` and `caption` fan out to a
  fixed 4. An input of 6 still drops clips 5 and 6. Check whether the pipeline schema can cap a number input.
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
- Runner: a loop `until: steps.X.passed` treats a missing `passed` as passed (`o.passed !== false`), so an agent that
  forgets the key ends its check loop as if it passed. Used by deep-research-cited, footage-to-edit,
  security-review-and-upgrade, seo-audit-fix and study-notes-to-pdf.
