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
| M3-01 | IN PROGRESS | Wiring tests in core/test/m3-e2e.test.ts (by Claude). data-to-dashboard WIRING 2026-10-08T23:00+11:00: real `data/load` on input/orders.csv (20 orders over two weeks with a duplicate, DD/MM dates, `$` prices, a blank region and a blank qty) into raw, row count and columns checked against the file, every agent step done in order, pauses at the signoff handoff gate, done on approve. Dev command swapped for a node server so the test needs no `npx` download. seo-audit-fix WIRING 2026-10-08T23:00+11:00: five audit lanes, fix in a worktree, speed loop, pauses at approve with guards_step deploy and an action hash, vercel never called before approve and called once with `--prod` after. Crawl is a fake step because `seo/crawl` refuses loopback hosts, so there is no local fixture site to crawl. deep-research-cited WIRING 2026-10-08T23:35+11:00: pauses at approve-plan before any search; the fixture sources (input/sources, two texts and sources.json) are copied in at the gate; real `cite-check` binds both quotes of a correct report and the run ends done; with one planted figure it fails that quote, the patch loop runs twice and the run pauses at loop-max. Search is a fake step because `agent-reach/search` needs Exa over the network. Left: footage-to-edit, clips-to-scheduled-posts, prospect-list-to-drafts, inbox-triage-drafts, study-notes-to-pdf, form-fill-batch. |
| M3-02 | VERIFIED-WINDOWS | c271cff: core/test/m3-plugins.test.ts cite-check planted-quote and curly-quote cases. |
| M3-03 | TODO | form-fill-batch handoff on the captcha stand-in. tests/fixtures/form-fill-batch holds only the UI mock (run.js); the local test form is not built. |
| M3-04 | IN PROGRESS | 2026-10-08T23:35+11:00: 17 templates in `pipelines/templates/` (Wasif's pick: a subfolder, so `store.ts`, which reads only `pipelines/*.json`, never seeds them as runnable). Catalog 3, 4, 5, 9, 15, 16, 18 to 22, 24, 25 and A1 to A4; all 17 pass `validatePipeline` against the real plugin manifests. 13 name future plugins in `requires` (tts, video-gen, social-posts, sheets, cms, chat, calendar, tasks, keyword-data, search-console, answer-engines, youtube, image-gen), so they never show ready until those exist. Left: the gallery listing with ready computed from installed plugins, and its test. |
| M3-05 | TODO | Tauri tray. Needs a Rust toolchain; ask before installing. |
| M3-06 | PARTIAL | `run_in: cloud` refused with -32040 (runner.ts:149). `provider: gateway` has the type (registry.ts:25) but no refusal found. Account state and the zero-outbound check not built. |

## Real runs

- data-to-dashboard on a small CSV with a real engine: his pick for the first one; needs him on screen.

## Hardening notes

- #33: `max_clips` has `default: 4` and a "4 at most" label but no maximum, while `cut` and `caption` fan out to a
  fixed 4. An input of 6 still drops clips 5 and 6. Check whether the pipeline schema can cap a number input.
- #35: the runner saves an action step's result as `<run_dir>/<step id>.json`, and the step is named `cite-check`, so
  the runner's `{ok, outputs}` file overwrites the plugin's own `cite-check.json`. `patch` is told to read the failures
  there; they are still in it, one level down under `outputs`.
