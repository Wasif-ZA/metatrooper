# M3 status ledger

Branch m3-harden, from main at 4752228 (2026-10-08). Status values as in M1-STATUS.md. Unfinished criteria first,
then each issue (#32 to #42) is re-read and hardened one at a time.

M3-01 is met the M2-01 way: each built-in runs on a fake engine with its real plugin actions, reaches every gate
with the guarded step not run, and finishes on approve. A real-engine run of each is dogfooding, listed under
"Real runs", not claimed here.

| Criterion | Status | Evidence / notes |
|---|---|---|
| M3-01 | IN PROGRESS | core/test/m3-e2e.test.ts (by Claude). data-to-dashboard VERIFIED-WINDOWS 2026-10-08T22:48+11:00: real `data/load` on a 4-row CSV (one duplicate, mixed dates and prices) into raw, every agent step done in order, pauses at the signoff handoff gate, done on approve. Dev command swapped for a node server so the test needs no `npx` download. Left: footage-to-edit, clips-to-scheduled-posts, seo-audit-fix, deep-research-cited, prospect-list-to-drafts, inbox-triage-drafts, study-notes-to-pdf, form-fill-batch. |
| M3-02 | VERIFIED-WINDOWS | c271cff: core/test/m3-plugins.test.ts cite-check planted-quote and curly-quote cases. |
| M3-03 | TODO | form-fill-batch handoff on the captcha stand-in. tests/fixtures/form-fill-batch holds only the UI mock (run.js); the local test form is not built. |
| M3-04 | TODO | No templates exist yet (catalog 3, 4, 5, 9, 15, 16, 18 to 22, 24, 25 and A1 to A4). Where they live is Wasif's call: `store.ts` seeds every `pipelines/*.json` as a runnable builtin. |
| M3-05 | TODO | Tauri tray. Needs a Rust toolchain; ask before installing. |
| M3-06 | PARTIAL | `run_in: cloud` refused with -32040 (runner.ts:149). `provider: gateway` has the type (registry.ts:25) but no refusal found. Account state and the zero-outbound check not built. |

## Real runs

- data-to-dashboard on a small CSV with a real engine: his pick for the first one; needs him on screen.

## Hardening notes

- #33: `max_clips` has `default: 4` and a "4 at most" label but no maximum, while `cut` and `caption` fan out to a
  fixed 4. An input of 6 still drops clips 5 and 6. Check whether the pipeline schema can cap a number input.
