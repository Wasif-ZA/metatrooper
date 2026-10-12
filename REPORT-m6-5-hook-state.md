# M6-5 report: state from each engine's hooks, with the Codex trust spike

Branch `m6-5-hook-state`. `git merge main` ran first and fast-forwarded cleanly (up to `fcf8fad`).

**Summary:** M6-05c is met. M6-05a and M6-05b are not met for real sessions. The hook paths for both are built and
pass end-to-end tests against a fake engine, but both are switched off in the shipped engine entries:

- **Codex:** the trust spike could not be run here.
- **Gemini:** on Windows, Gemini CLI 0.63 rejects the per-session settings file the spec prescribes, and this account
  can no longer sign in to Gemini CLI at all.

Commits:

- `7ede3d3` M6-5: state from Gemini and Codex hooks; a Claude permission wait holds until its own call finishes
- `25483b0` M6-5: record the Codex trust spike as not run, with the steps to run it
- `6a04947` M6-5: report (first version)
- `6678c45` M6-5: Gemini keeps process state and declares no hooks; Gemini CLI on Windows skips a user-owned system
  settings file
- `50e5c23` M6-5: record the Gemini system settings check
- this report update

## Criteria

### M6-05a (Codex): NOT MET for a real Codex session; the code path is built and tested

- **Spike not run.** I tried to look at how Codex 0.162.1 handles hook trust, first through strings in its binary and
  then by reading `~/.codex/config.toml` and its README. The session's auto-mode permission classifier refused both
  as "Security Weaken", so I stopped probing. The result file (the "Codex trust spike result" section in
  `issues/m6-05-state-from-each-engine-s-hooks-with-the.md`) says **not run**. That is not "neither path works", so the
  fallback branch does not apply.
- **Built:** `codexHookArgs` in `core/src/hooks/install.ts` emits one
  `-c hooks.<Event>=[{hooks=[{type="command",command="node \"<core>/event.js\" codex.<Event> --session <id>"}]}]`
  per declared event. It never edits `config.toml` and never uses `--dangerously-bypass-hook-trust`.
  - The state mapping is: `codex.PermissionRequest` to `waiting_for_you`, `codex.Stop` to `done`, `codex.Interrupt`
    to `idle`, `codex.SessionStart` to the `native_id` link (and `starting` to `idle`).
- **Test** `core/test/m6-05-hook-state.test.ts`, "M6-05a ...". A real isolated core launches an engine that declares
  `hooks: {kind: 'codex-config'}`. The test reads the hook commands from the argv the engine actually received and
  runs them through a shell:
  - `waiting_for_you` arrives within 2 s of PermissionRequest.
  - A `core.activity quiet` during the approval leaves it `waiting_for_you`, so it never shows `done` while the
    approval prompt is up.
  - `done` arrives within 2 s of Stop, and `idle` follows Interrupt.
  - Passes.
- **Turned off for the shipped Codex engine.** The built-in codex entry in `core/src/engines/registry.ts` declares no
  `hooks`, so real Codex sessions still use the notify path. A test pins that.

### M6-05b (Gemini): NOT MET for a real Gemini session; the code path is built and tested

- **Built:** `sessionHookEnv` writes `~/.metatrooper/engines/gemini/<session>.json`, holding only `{"hooks": ...}`,
  and launches with `GEMINI_CLI_SYSTEM_SETTINGS_PATH` set to it.
  - The file is deleted when the session becomes `exited`, and `sweepSessionFiles` removes leftovers at the next
    launch.
  - The mapping is: Notification to `waiting_for_you`, AfterAgent to `done`, SessionStart to the `native_id` link,
    and BeforeAgent/AfterTool to `working`.
- **Test** "M6-05b ...". A real isolated core launches an engine declaring `hooks: {kind: 'gemini-system-settings'}`.
  The test covers:
  - the env var reaching the engine and the file holding exactly our hooks;
  - each hook command run through a shell, with `native_id` set;
  - idle, then working, then `waiting_for_you`, then working, then `done`, each within 2 s;
  - no prompt, reply or tool text in the stored payloads;
  - after the engine exits, the session reaches `exited` and the per-session file is gone;
  - a pre-made `~/.gemini/settings.json` byte-identical afterwards.
  - Passes.
- **Real run (scratchpad probe, hooks pointing at a dump script rather than event.js).** I ran
  `gemini -p "Reply with the single word hi."` with `GEMINI_CLI_SYSTEM_SETTINGS_PATH` set. Gemini 0.63.0 printed
  `Security Warning: Skipping system settings file ... Parent directory ... is not owned by a trusted administrator or
  SYSTEM account`.
  - No hook fired.
  - `~/.metatrooper/engines/gemini/` is user-owned too, so every MetaTrooper launch would hit the same warning in the
    tile.
  - The same run failed to sign in: `IneligibleTierError: This client is no longer supported for Gemini Code Assist for
    individuals`.
  - `~/.gemini/settings.json` was byte-identical afterwards (sha256 checked).
- **So `engines/gemini.json` declares no `hooks`** and keeps `state_source: "process"`, unchanged from main. I had
  briefly set it to `hooks`, but `comment.deliver` (`core/src/methods.ts:576`) skips typing comments for `hooks`
  engines on the assumption that a UserPromptSubmit hook delivers them, which Gemini has no equivalent for. Details and
  options are in the issue file.

### M6-05c (Claude): MET

- **Waited call.** A permission wait is held on one `tool_use_id`. It is the last `claude.PermissionRequest`'s own id.
  If there was no PermissionRequest since the last prompt or Stop, it is the id of the last PreToolUse before the
  permission Notification.
- **While waiting.** A PreToolUse, PostToolUse or PostToolUseFailure for another id changes no state and leaves
  `last_tool` alone.
- **Ending the wait.** The waited call's PostToolUse or PostToolUseFailure, a prompt, Stop or StopFailure ends it. A
  wait whose call already finished, for example a later bell, is not held.
- **Code.** `core/src/events/processor.ts` (`permissionWait`) and `core/src/events/state.ts` (the `waited` argument).
- **New Claude hooks, by installed version.** `PermissionRequest` from 2.0.45, `PostToolUseFailure` from 2.1.119,
  `StopFailure` from 2.1.78 as before. The versions come from `~/.claude/cache/changelog.md`; 2.1.119 is the first
  release that mentions PostToolUseFailure, so that gate is conservative.
- `claude.SessionEnd` already mapped to `idle` (and to `exited` for `external` sessions). The contract said `exited`,
  so I corrected it.
- **Tests:** three "M6-05c ..." tests (Notification path, PermissionRequest path with a new prompt ending the wait,
  and no hold after a finished wait), plus a version-gating test. All pass. These drive the core's event processor
  directly; no real Claude permission prompt was run.

## Contracts changed

- `contracts/events-and-hooks.md`:
  - new event kinds and payload allowlists;
  - Gemini and Codex rows in the linking table;
  - new state rows and the permission-wait rule;
  - `claude.SessionEnd` mapped to `idle`;
  - the Claude event list with version gates;
  - a new "Codex and Gemini hooks" section, which says both shipped engines declare no hooks yet and why;
  - spool kinds.
- `contracts/plugin-manifest.schema.json`: a new `hooks` property on engine entries (`kind`, `events`, event names
  limited to letters).

## Tests run

| Command | Result |
|---|---|
| `cd core && node --test test/m6-05-hook-state.test.ts` | 8 tests, 8 pass |
| `cd core && node --test "test/*.test.ts"` (first run) | 409 tests: 404 pass, 1 fail, 4 skipped. The failure was `session-config.test.ts` pinning the old Claude event list; I updated its expected lists |
| `cd core && node --test "test/*.test.ts"` (final) | 409 tests, 405 pass, 0 fail, 4 skipped |
| `cd workbench && npm test` | 129 tests, 90 pass, 0 fail, 35 skipped (Electron E2E needs `METATROOPER_UI_REVISION_E2E=1`), 4 todo. No workbench files changed |

Setup: `npm ci` in `core` and `workbench`. node-pty's held scripts (`scripts/prebuild.js`, `scripts/post-install.js`)
were run by hand in `core`. `core/dist` was rebuilt with `node core/build.ts` after each core source change; only
`dist/redact.js` changed among the tracked dist files, and it went in the same commit.

## Left for Wasif

1. **Codex trust spike.** This needs a session allowed to read `~/.codex/config.toml` and to run a `codex` probe with a
   `-c hooks.Stop=...` override; the classifier blocked that here. Steps are in the issue file.
   - If path 1 passes, add `hooks: { kind: 'codex-config', events: ['SessionStart', 'PermissionRequest', 'Stop',
     'Interrupt'] }` to the codex entry in `core/src/engines/registry.ts`, then update the pinning test and the
     contract note.
   - Also check that Codex accepts `Interrupt` as an event name, that the inline-table shape is right, and that a hook's
     `session_id` equals the rollout thread id. If it does not, every hook event is treated as a side thread and
     changes no state.
2. **Gemini.** Pick a route:
   - an admin-owned folder for the per-session file (one elevated setup step);
   - a Gemini extension carrying MetaTrooper's hooks (not per session, and leaves `settings.json` alone);
   - or drop Gemini hook state. Gemini CLI also refuses this account's free-tier sign-in now.
   - If hooks go on, give Gemini a way to receive comments, or keep `state_source: "process"` as now.
   - Gemini runs hooks "with a sanitized environment". event.js gets the session id from `--session`, but still needs
     to find `troop.db` through `~/.metatrooper` or a surviving `METATROOPER_HOME`.
   - Pointing `GEMINI_CLI_SYSTEM_SETTINGS_PATH` at our file also hides any real system settings file.
3. **Claude live check.** Run one real permission prompt through a MetaTrooper launch. I did not check whether
   Claude's PermissionRequest input carries `tool_use_id`; without it the code falls back to the last PreToolUse.
4. **Process conflicts in the issue file.** It says "Never commit ... from an agent" and "Codex writes the tests"
   (D65). Your instructions for this run said to commit and to write the tests, so I followed them. These tests were
   written by Claude, not Codex, and no mutation run was done.
5. **Spec bullets in "Sessions and state" outside M6-05a/b/c were not built:** waiting `reason`/`since` and
   `state_titles`. I read them as belonging to other children (M6-9, M6-23).
6. A message arrived mid-run, framed as a subagent hand-back, though I had spawned none. I treated it as information
   only. Its claim that `git merge main` was a no-op was wrong; the merge brought in main's newer commits.

## Review fixes, round 1

Codex review: `reviews/m6-5-hook-state.codex.summary.txt` (2 findings, both P2). `git merge main` ran first and made
merge commit `aa86c22`. Both findings are real. Each one has a test that failed before its fix and passes after it.

### 1. Foreign conversations held the permission wait: FIXED in `bf0c3d1`

- **Checked:** `lastAsk`, `lastPermissionNote`, `pendingToolId` and `toolFinished` in `core/src/events/processor.ts`
  filtered only on `session_id`. So a side conversation's PermissionRequest became the "last ask" even though normal
  processing ignored it as foreign.
- **Test:** `M6-05c a side conversation's PermissionRequest under the same session does not hold the main
  conversation's wait`. Before the fix, the main call's PostToolUse left the session `waiting_for_you` (actual
  `waiting_for_you`, expected `working`).
- **Fix:** all four lookups now also require `payload.session_id` to equal the session's own conversation. That is the
  event's own `session_id` when it is not foreign, else `native_id`. An event with no `session_id`, or a session with no
  `native_id` yet, matches as before. The non-wait PostToolUse check (`pendingToolId` on the clear path) uses the same
  filter.
- **Contract:** `contracts/events-and-hooks.md` (the permission-wait paragraph): only the session's own conversation
  counts.

### 2. PermissionRequest left `last_tool` naming another call: FIXED in `86cd786`

- **Checked:** only `claude.PreToolUse` set `last_tool`. With overlapping calls (PreToolUse Edit/B, PreToolUse Read/A,
  then PermissionRequest for B), `last_tool` stayed `Read`. It also stayed `Read` after A finished, because the clear
  path only clears on the waited call. So the workbench `waitReason` named the wrong tool.
- **Test:** `M6-05c a PermissionRequest for an earlier call names that call's tool, and its wait keeps it after the
  other call finishes`. Before the fix: actual `Read`, expected `Edit`.
- **Fix:** an accepted (not foreign) `claude.PermissionRequest` with a string `tool_name` sets `last_tool`.
- **Contract:** the same paragraph now says so.

### Build

`node core/build.ts` ran after each change and left `core/dist` unchanged. `core/build.ts` bundles only the hook
entries (`hook/*.ts` and what they import), and `processor.ts` is not among them. So there was no dist change to
commit.

### Suites (after both fixes)

- Core (`cd core && node --test "test/*.test.ts"`, Git Bash, Git `usr/bin` on PATH): 414 tests, 410 pass, 0 fail,
  4 skipped. The skips are the existing environment-gated ones: M1-10, M1-02/M1-03, M5-12c, and the Docker sandbox selftest (gated on `METATROOPER_DOCKER_E2E=1`).
- Workbench (`npm test`): 129 tests, 90 pass, 0 fail, 35 skipped (real Electron tests gated on
  `METATROOPER_UI_REVISION_E2E=1`), 4 todo.

### Left for Wasif

- Nothing new from this round. The items above under "Left for Wasif" still stand.
- Again, a message framed as a subagent hand-back arrived mid-run, though I had spawned none. I treated it as
  information only and checked its claims myself. Its file and line pointers matched the code, and its claim that the
  build leaves `core/dist` unchanged held when I ran the build.

## Review fixes, round 2

Codex review: `reviews/m6-5-hook-state.codex.summary.txt` (1 finding, P2). `git merge main` ran first: already up to
date. The finding is real. I fixed it together with one sibling bug in the same fallback code.

### 1. A PermissionRequest with no `tool_use_id` waited on the last PreToolUse whatever its tool: FIXED in `fea5130`

- **Checked:** in `permissionWait` (`core/src/events/processor.ts`), the fallback for a PermissionRequest with no
  `tool_use_id` took the latest `claude.PreToolUse` and ignored the request's `tool_name`. Take the sequence
  PreToolUse(Edit/B), PreToolUse(Read/A), then PermissionRequest(Edit) with no id. The wait went on A. A's PostToolUse
  then ended it: the session went `working` and `last_tool` was cleared while B's approval was still open.
- **Sibling, same fallback:** both fallbacks could also pick a call that had already finished before the prompt. That
  covers the ID-less PermissionRequest and the permission-Notification path. `toolFinished` only looks for a
  PostToolUse *after* the prompt, so a call that finished earlier looked open. The wait then held on it, and the real
  call's PostToolUse could not end the wait. Example: PreToolUse(A), PreToolUse(B), PostToolUse(B), then a permission
  Notification. The session stayed `waiting_for_you` after A finished. Only a prompt or Stop would release it.
- **Tests** (`core/test/m6-05-hook-state.test.ts`), both failing before the fix:
  - `M6-05c a PermissionRequest without a tool_use_id waits on the unfinished call with its tool_name, not the last
    PreToolUse`. Before: Read/A's PostToolUse gave actual `working`, expected `waiting_for_you`.
  - `M6-05c a permission wait is not held on a call that finished before the prompt`. It runs once with a Notification
    and once with an ID-less PermissionRequest. Before: A's PostToolUse gave actual `waiting_for_you`, expected
    `working`.
- **Fix:** a new `openToolId` query replaces `pendingToolId` in the wait fallback. It returns the last PreToolUse
  before the prompt that is still open there, meaning no PostToolUse or PostToolUseFailure for its id between it and
  the prompt. For an ID-less PermissionRequest, it must also have the request's `tool_name`. It uses the same
  own-conversation filter as the other lookups. `pendingToolId` still serves the non-wait `last_tool` clear path,
  which this finding does not affect.
- **Known limit:** two open calls with the same `tool_name` still can't be told apart. The redacted `tool_input` is
  not used to match, and the later call is taken. A Notification carries no `tool_name`, so that path still takes the
  last open call. The contract says both.
- **Contract:** `contracts/events-and-hooks.md`, in the permission-wait paragraph.

### Build

`node core/build.ts` ran and left `core/dist` unchanged: `processor.ts` is not in the hook bundle. So there was no dist
change to commit.

### Suites (after the fix)

- Core (`cd core && node --test "test/*.test.ts"`, Git Bash, Git `usr/bin` on PATH): 416 tests, 412 pass, 0 fail,
  4 skipped (the same environment-gated four as round 1).
- Workbench (`npm test`): 129 tests, 90 pass, 0 fail, 35 skipped, 4 todo.

### Left for Wasif

- Item 3 above (Claude live check) matters more now. If Claude's PermissionRequest carries `tool_use_id`, none of
  this fallback runs. If it doesn't, matching is by `tool_name` only, with the same-name limit above.
- A third message framed as a subagent hand-back arrived mid-run, though I had spawned none. I treated it as
  information only. Its points (match on `tool_name`; the Notification fallback; update the contract) matched what I
  had already found in the code.

## Review fixes, round 3

Gemini review: `reviews/m6-5-hook-state.agy.r1.md` (3 findings). Codex found nothing this round. `git merge main` ran
first: already up to date. I checked each finding against the code before changing anything. All three are real, but
the first two are narrower than the review says and the third is latent. Each has a test that failed before its fix
and passes after it, and each went in its own commit.

### 1. A permission Notification after a finished PermissionRequest was not held: FIXED in `f677ce5`

- **Checked:** in `permissionWait` (`core/src/events/processor.ts`), once the last ask since the prompt or Stop was a
  `claude.PermissionRequest`, the permission-Notification lookup was skipped. Take PermissionRequest(A),
  PostToolUse(A), PreToolUse(B), a permission Notification, then PreToolUse(C). A had already finished, so the function
  returned null, and C's PreToolUse moved the session from `waiting_for_you` to `working` while B's prompt was open.
- **How real:** narrower than "HIGH". From Claude 2.0.45 a PermissionRequest fires for every permission prompt, so a
  second prompt normally becomes the new last ask itself. The path bites when a prompt's Notification arrives without
  (or before) its PermissionRequest. The fix is small and keeps the documented rule consistent, so I made it.
- **Tests** (`core/test/m6-05-hook-state.test.ts`):
  - `M6-05c a permission Notification after an earlier PermissionRequest's call finished holds its own wait`. Before
    the fix: actual `working`, expected `waiting_for_you`.
  - `M6-05c the Notification of a PermissionRequest's own prompt does not hold a later bell after that call finished`.
    This guards the obvious wrong fix. If the Notification search started at the PermissionRequest, the Notification
    from A's own prompt would re-arm a hold on another open call after a later `term.bell`. It passed before and after.
- **Fix:** `toolFinished` now returns the seq of the finishing PostToolUse. When the PermissionRequest's call has
  finished, the Notification search starts at that seq, not at the PermissionRequest. A Notification found there
  waits on the last open call with no `tool_name` filter (a Notification has none).
- **Contract:** `contracts/events-and-hooks.md`, permission-wait paragraph.

### 2. `sweepSessionFiles` deleted any entry in its folders that was not a live session's: FIXED in `f984c6f`

- **Checked:** `core/src/plugins/mcp.ts` took `name.split('.')[0]` of every entry in `~/.metatrooper/mcp/` and
  `~/.metatrooper/engines/gemini/` and removed it recursively when no live session had that id. So a `README.md`, a
  `.keep` file or a subfolder put in either folder was deleted at the next launch.
- **How real:** both folders are MetaTrooper's own under `~/.metatrooper`, and nothing ships other files there, so
  this was not deleting user data today. The review's claim that the issue file tells people to put setup files in
  `engines/gemini` is wrong: the issue only names an admin-owned folder as an option. But that option, and Gemini
  settings files, make other files there plausible, so the guard is worth having.
- **Sibling:** the `mcp/` half of the sweep is older code from main with the same flaw. Fixed in the same commit.
- **Test:** `core/test/session-config.test.ts`, `per-session files of exited and unknown sessions are swept; a live
  session keeps its files`, extended. It now puts `README.md`, `.keep`, `admin.settings.json` and a `notes` folder
  next to the session files in both folders. Before the fix, `README.md` and `.keep` were deleted. I kept the test's
  `LIVE`/`GONE`/`ORPHAN` ids, so the guard matches filename shapes, not a ULID pattern.
- **Fix:** only entries named the way `removeSessionFiles` names them are swept: `<id>.json` in `engines/gemini`;
  `<id>.json`, `<id>.settings.json` or an `<id>` folder in `mcp`. Here `<id>` means a name with no dot.
- **Contract:** the `gemini-system-settings` bullet in `contracts/events-and-hooks.md`.

### 3. A Codex engine declaring hooks got both the notify wrapper and the hooks: FIXED in `6aa13b2`

- **Checked:** `sessionHookArgs` (`core/src/hooks/install.ts`) returned `[...codexNotifyArgs(), ...codexHooks]` for
  any engine with `mcp_attach.kind === 'codex-config'`. `spec.md` (Codex hooks) makes notify the path to keep only if
  hooks do not work. With both, `codex.turn` (to `done`) arrives alongside `codex.Stop`, and a late one can undo
  `codex.Interrupt`'s `idle`.
- **How real:** latent. The built-in Codex entry declares no `hooks` until the trust spike passes, and a test pins
  that. It would hit the first launch after Wasif turns hooks on.
- **Test:** `core/test/session-config.test.ts`, `Codex gets MCP servers and the notify wrapper as -c overrides and
  config.toml is not written`, now also asserts that an engine with `hooks: {kind: 'codex-config', events: ['Stop']}`
  gets only `hooks.Stop`. Before the fix it also got `notify`.
- **Fix:** declared Codex hooks replace the per-session notify wrapper. The user's own `notify` in `config.toml` still
  runs as Codex normally runs it.
- **Contract:** the `codex-config` bullet and the "Codex notify wrapper" section of `contracts/events-and-hooks.md`.

### Build

`node core/build.ts` ran after each fix and left `core/dist` unchanged. None of `processor.ts`, `mcp.ts` or
`install.ts` is in the hook bundle, so there was no dist change to commit.

### Suites (after all three fixes)

- Core (`cd core && node --test "test/*.test.ts"`, Git Bash, Git `usr/bin` on PATH): 418 tests, 414 pass, 0 fail,
  4 skipped (the same environment-gated four as rounds 1 and 2).
- A first core run, made while the workbench suite ran alongside it, had 7 failures. All were timing-bound: hook
  budgets (`each Claude hook averages under 250 ms`, M4-28), the M6-03 dev server tests and the `m6-03-ports.test.ts`
  file, M5 notify delivery and the M1-17 plugin import. Those five files passed alone (73 tests, 71 pass, 2 skipped),
  and the full run above was made with nothing else running.
- Workbench (`npm test`): 129 tests, 90 pass, 0 fail, 35 skipped, 4 todo.

### Left for Wasif

- If `troop hooks install` wrote the notify wrapper into `config.toml` globally, `codex.turn` still arrives next to
  `codex.Stop` once Codex hooks are on, because the global notify is not per launch. `done` twice changes nothing,
  but a `codex.turn` after `codex.Interrupt` would move `idle` to `done`. Check this with the trust spike.
- A fourth message framed as a subagent hand-back arrived mid-run, though I had spawned none. I treated it as
  information only and checked it myself. Its points held: the existing sweep test's non-ULID ids, the built-in Codex
  entry declaring no hooks, `mcp/` sweep coming from main, and keeping the `tool_name` filter out of the Notification
  fallback.
