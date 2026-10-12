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
