# M6-6 report: everything comes back after a restart

Branch `m6-6-restart`, commits `d38f7a9` (core) and `8b47d8f` (workbench). Nothing is merged, pushed or rebased.

## Criteria

### M6-06a: 4 live sessions come back in their tiles, same layout, within 30 s, never more than 3 resuming at once

**Met for what the tests can reach. Not run against real claude, codex and gemini in a real Electron window.**

What was built:

- `core/src/sessions/resume-all.ts`. At start, before any event is processed, the core reads every `pty` session the
  last core left open (`liveAtStart`). That covers a hard kill (rows never closed) and `troop stop` (its
  `process-gone` events are still unprocessed). Each one gets `core.process-gone {pid: null}`, which raises no
  `failed` item, and is resumed through `session.resume`. That reuses the existing `resume_args` and `native_id` code.
  The `Resumer` keeps at most 3 resuming at once, 2 s plus up to 1 s of random jitter apart. A session counts as
  resuming while it is `starting`, for at most 10 s, so an engine that never leaves `starting` cannot hold a slot past
  the 30 s budget. The window's selected session is moved to the new id.
- `session.resume` writes `core.resumed {from: <old id>}` on the new session. The snapshot gets it as `resumed_from`
  (`workbench/src/queries.ts`).
- The workbench saves the layout through `settings.set` on every layout change, debounced 500 ms. The layout is the
  big slot, the pair and its slot, the order, the opened done tiles and the project's shells, under
  `ui.layout[<project id>]`. A new IPC `saveLayout` calls the existing `writeSetting`. On start, once the core is
  online, `wall.restore` gets the saved layout and each tile is placed in its old slot as it arrives, keyed by its
  id or its `resumed_from`. Saved shells open again, and the new `sh_` id takes the old shell's slot. If the
  workbench stays open while only the core restarts, a new core pid re-seeds the wall from its current layout and
  reopens the shells that died with it.
- While tiles are still coming back, `state()` saves the saved layout (with the ids of tiles already back), so a
  second restart in that window loses nothing. Saved ids that have not come back after 60 s are dropped.

Evidence:

- `core/test/m6-06-restart.test.ts`, "killing the core brings 4 live sessions back within 30 s, never more than 3
  resuming at once". A spawned test core in a temp home (not your core) launches 4 sessions on 3 fake engines. The
  test kills the core outright, starts it again on the same home, and checks:
  - all 4 old ids are resumed (`core.resumed`);
  - the last one starts under 30 s after the restart (about 12 s here);
  - no more than 3 start inside any 10 s window, and starts are at least 2 s apart;
  - the old rows are `exited`.
  Passes in 15.4 s.
- Unit tests on a fake clock check: the cap, the gap and jitter bounds, the 4th waiting for a slot, and a slot
  freeing as soon as a session leaves `starting`.
- `workbench/test/m6-06-layout.test.ts`. The first wall has a big slot, a pair, an opened done tile and a shell.
  A fresh wall restores that layout from all 120 arrival orders of the resumed tiles and the reopened shell. Big,
  pair, `pair_at`, order and open tiles match every time. Two more tests cover a tile still missing from the saved
  layout, and `seedLayout`, `reopenShell`, `saveLayout` and `coreRestarted`.

### M6-06b: two `auth_error` failures stop that engine and raise one needs-you item; an exited session shows its saved last screen

**Met in tests. The three real `auth_error` patterns are not checked against real CLI output (see below).**

- New engine field `auth_error`: a regex matched case-insensitively against the last 200 rows of a resumed session's
  screen, at most 200 characters. It is added to the `EngineSpec` type, the claude and codex built-ins,
  `engines/gemini.json` and `contracts/plugin-manifest.schema.json`. A pattern that does not compile never matches.
- The `Resumer` checks each resumed session's screen once, from the live headless terminal or from the saved screen
  if the session has already exited. After 2 matches for one engine it drops that engine's remaining queue and
  inserts one `needs_you` row: kind `other`, ref `resume:<engine>`, text "<engine> needs signing in, so its sessions
  were not resumed after the restart (<login hint>)". A `NOT EXISTS` guard keeps it to one.
- Last screen: when a pty exits, and for every open terminal when the core stops, the core saves the last 200 rows
  to `~/.metatrooper/screens/<id>.json`, serialized and as plain text. When a pty exits, the save runs in the
  headless terminal's flush callback, before dispose. Attaching to an ended session that has a saved screen now sends
  `snapshot` and then `exit`, instead of `no-session`. Screens older than 30 days are deleted at core start.
- Contracts updated: `pipe-protocol.md` (attach to an ended session, `session.resume` writing `core.resumed`) and
  `events-and-hooks.md` (`core.resumed`, start-up `process-gone`).

Evidence:

- Integration test "an engine whose resume shows its auth_error twice...". 3 sessions of an engine that prints
  "please log in", plus 1 good session. After the kill and restart, exactly 2 of the locked engine's sessions are
  resumed, the good one is resumed, and there is exactly one `other` item on `resume:locked`.
- Unit tests check that one failure is not enough, a failure counts once, and a bad pattern never matches.
- "an exited session keeps its last 200 rows...". A process prints 300 rows and exits with code 3. The saved text
  has `row 299` and `LAST LINE` but not `row 50`. Attaching through the term pipe returns a snapshot with
  `LAST LINE`, then `{op: 'exit', code: 3}`. An unknown id still gets `no-session`.

## Test commands and results

| Command | Result |
|---|---|
| `cd core && node --test test/m6-06-restart.test.ts` | 8 pass, 0 fail (28 s) |
| `cd workbench && node --test test/m6-06-layout.test.ts test/renderer-guards.test.ts` | 17 pass, 0 fail |
| `cd core && node --test "test/*.test.ts"` | 345 tests: 340 pass, 4 skipped, 1 fail. The failure is `m5-notify.test.ts` "M5-15a/b new gate..." with `notify.sink.set timed out` under full-suite load. Rerun on its own: 8 of 8 pass. It does not touch this change. |
| `cd workbench && node --test --test-concurrency=1 "test/*.test.ts"` | 97 tests: 61 pass, 0 fail, 32 skipped (the opt-in Electron suites) |

Mutation run (D65). Each mutation was applied, the M6-6 test file run, then the file restored:

- killed: the cap raised to 4; `>=` changed to `>` on the auth threshold; the 2 s gap removed; the saved-screen
  branch removed from the term pipe; the save at exit removed; seeding removed from `wall.decide`; restoring opened
  tiles removed.
- survived: removing `markGone(db, wereLive)` from `main.ts`. `checkPids` also marks rows with dead pids exited
  before the first resume tick, so `markGone` only guards that race and the case of a launcher pid that is still
  alive. No test separates the two.

`npm ci` was run in `core/` and `workbench/` (with `--ignore-scripts` for workbench, so no Electron binary).
`node_modules` is git-ignored.

## Left for Wasif

1. **Real run not done.** You told me not to run `troop serve` or restart the core, so nobody has watched 4 real
   sessions (claude, codex, gemini, a shell) come back in Electron after killing both. That is the one check left for
   M6-06a.
2. **`auth_error` patterns are guesses.** None was checked against real CLI output:
   - claude: `invalid api key|please run /login|oauth token (has expired|revoked)|authentication_error`
   - codex: `not logged in|please (re-?)?log ?in|401 unauthorized|refresh token (has )?(expired|was revoked)`
   - gemini: `please set an auth method|failed to (log ?in|authenticate)|gemini_api_key.*not (set|found)|waiting for auth`

   Please check each against a signed-out run.
3. **Gemini does not truly resume yet.** `gemini --help` lists `--resume <latest|index>` and `--session-id <uuid>`, so
   I added `resume_args: ["--resume", "{native_id}"]`. Nothing links a gemini session's `native_id` on this branch,
   though: that is M6-5's SessionStart hook, and M6-5 is not merged here even though M6-6 depends on it. Until it is,
   a gemini tile comes back as a fresh gemini in the same folder ("No saved conversation, starting fresh."). Check
   whether `--resume` takes a UUID once M6-5 lands; if not, launching with `--session-id` is the way.
4. **Shells come back fresh.** A shell comes back as a new shell of the same kind in the project folder, with no
   scrollback or history. A shell the user ended with `exit` is also reopened.
5. **Scope cuts.** Only `host = 'pty'` sessions are resumed; sandbox and external sessions are not. A resumed session
   gets the folder's default approval, not the one it had, which is the existing `session.resume` behaviour.
6. **Possible inbox noise.** Closing the old rows runs the normal exit jobs, so a restarted session that owned
   uncommitted files can raise an `uncommitted` item, as any session that exits does.
7. **"Split sizes" from spec.md** have nothing to save yet: splitters arrive in M7-7, which plans to add its fractions
   beside `ui.layout`. Grid or single mode and the split panel stay in localStorage as before.
8. **Process conflicts.** D65 says Codex writes the M6-6 tests, and the issue says agents never commit. Your task told
   me to write the tests and commit, so I did both. The mutation run above is the D65 proof.
9. **An unexplained message.** During the session a message arrived framed as a hand-back from a subagent of this
   session, but I never started one. Its three claims (gemini had no `resume_args`, `checkPids` closes orphaned
   sessions within 5 s, `session.resume` mints new ids) matched the code, so I checked them myself and acted on what
   I verified, not on the message.
