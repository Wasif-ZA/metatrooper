# M6-24 report: Limits that carry on

Branch `m6-24-limits`. Spec: `issues/m6-24-limits-that-carry-on.md` and `spec.md` ("Limits that carry on", M6-24a and M6-24b).

## Criteria

| Criterion | Status | Evidence |
|---|---|---|
| M6-24a. The reset of a limit-hit passes (fake clock): "Continue where you left off." is pasted exactly once | Met | `core/test/m6-24-limits.test.ts`, test "M6-24a a rate-limit StopFailure pastes ... once after resets_at". A `claude.StopFailure {error_type: rate_limit}` fixture is processed and gives `waiting_for_you` plus one `core.limit-hit` whose `resets_at` is the 5h reading's reset. `resumeAtReset` with the clock before the reset types nothing. After the reset it pastes the line and `\r` once; a second call types nothing |
| M6-24a. A core restart after that does not paste again | Met | Same test: the database file is closed and reopened, `resumeAtReset` runs again and nothing is typed. There is still exactly one `core.limit-resumed` event, keyed by the limit-hit's `seq` and written before the paste |
| M6-24a. With the tile's toggle off, nothing is pasted | Met | Test "M6-24a with the tile toggle off nothing is pasted" (`session.limit_resume = 0`) |
| M6-24b. Six readings 10 min apart, 40% to 90%, reset 2 h after the last: one early-end item naming a time 10 min after the last reading | Met | Test "M6-24b six readings 40% to 90% ...". No item after readings 1 to 5. After the sixth there is exactly one `needs_you` item: `Claude 5h window ends early at about HH:MM`, where HH:MM is the local time of last reading + 10 min. A repeat reading and check still leaves one item, and `limit_history` holds 6 rows |

More tests: no paste after a later prompt, with the pty closed, or for a non-rate-limit failure. Claude's idle notification does not block the paste. No early-end item when the slope runs out after the reset, and only the last 6 readings are kept.

Mutation run (D65): five hand mutations of `limit-resume.ts`, each caught by at least one test:
- once-guard inverted (2 fail)
- toggle ignored (1)
- reset comparison dropped (1)
- fires after 2 readings (1)
- notifications block the paste (1)

## What changed

- `core/src/sessions/limit-resume.ts` (new): `limitHit`, `resumeAtReset`, `recordReadings`, `earlyEnd`.
- `core/src/events/processor.ts`: a `claude.StopFailure` with `error_type: rate_limit` writes `core.limit-hit` in the same transaction.
- `core/src/events/state.ts`: `claude.StopFailure` maps to `waiting_for_you`.
- `core/src/redact.ts`: payload allowlist and spool kind for `claude.StopFailure`.
- `core/src/main.ts`: `resumeAtReset` every 5 s; readings are recorded and the early-end check runs after each 60 s `readLimits`.
- `core/src/methods.ts` + `workbench/src/main.ts`: `session.limit-resume {session_id, on}` (UI-allowed).
- `contracts/schema.sql` + `core/src/store/db.ts`: `session.limit_resume INTEGER NOT NULL DEFAULT 1` and a new `limit_history` table. Both are added through the existing add-column / `CREATE TABLE IF NOT EXISTS` chain, not a numbered migration, because a fresh database runs `schema.sql` and then every migration.
- `contracts/events-and-hooks.md`: `claude.StopFailure`, `core.limit-hit` and `core.limit-resumed` rows, the state row, and a "Resume at a limit reset" section. `contracts/pipe-protocol.md`: `session.limit-resume`.
- Workbench: an "At reset: go on / wait" toggle on big Claude tiles (`terminal.js`, `style.css`), its click handler, and a palette action for the selected session (`app.js`). `queries.ts` returns `limit_resume`, falling back to 1 on an older database.

## Tests run

- `cd core && node --test test/m6-24-limits.test.ts`: 6 pass, 0 fail.
- `cd core && npm test`: 343 tests, 339 pass, 0 fail, 4 skipped (exit 0).
- `cd workbench && node --test test/queries.test.ts test/renderer-guards.test.ts test/m6-25-context-fill.test.ts test/m6-20-cost-chip.test.ts`: 22 pass, 0 fail. The full workbench suite (Electron) was not run.

`npm ci` was run in `core/` because the worktree had no `node_modules`.

## Left for Wasif

1. **M6-23 is not built on any branch.** M6-24 depends on its `claude.StopFailure` handling, so this branch adds only the slice it needs: the payload allowlist and the `waiting_for_you` mapping. It does not add the `stopped: <error_type>` reason, because no reason/since columns exist yet.
2. **The `StopFailure` hook is not installed.** It is missing from `hooks/install.ts` EVENTS and from the sandbox hook list. The spec says to install it "when the CLI version lists it", which needs a version gate, and an unknown hook name could break the settings of an older Claude Code. Until M6-23 adds that gate, resume at reset never fires in real use; the core side is ready and tested.
3. **Which reset is used.** Claude's StopFailure payload is not known to carry `resets_at`, so the core takes it from `limit_reading`: the latest reset among Claude windows at 100% or more, else the fullest window's reset. This needs checking against a real rate-limit payload.
4. **Rules that conflicted.** The issue says agents never commit and that Codex writes the M6-24 tests (D65). Your task told me to commit and add tests, so I did both. You may still want a Codex `/tests-brief` pass.
5. **Early-end item details.** It uses needs-you kind `other`, because a new kind would mean rebuilding the `needs_you` table's CHECK on every install. It needs 6 readings from the same reset period. A reading is recorded only when `read_at` changes (one statusline or rollout write), and the core polls every 60 s.
6. **Where the toggle shows.** It appears only on big panes (the tile head is too crowded elsewhere) and through the palette. Nobody has looked at it in the running app.
