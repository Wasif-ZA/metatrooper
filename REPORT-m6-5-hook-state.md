# M6-5 report: state from each engine's hooks, with the Codex trust spike

Branch `m6-5-hook-state`. `git merge main` ran first and fast-forwarded cleanly (up to `fcf8fad`). Commits:

- `7ede3d3` M6-5: state from Gemini and Codex hooks; a Claude permission wait holds until its own call finishes
- `25483b0` M6-5: record the Codex trust spike as not run, with the steps to run it
- this report

## Criteria

### M6-05a (Codex): NOT MET for a real Codex session; the code path is built and tested

- **Spike not run.** I tried to look at how Codex 0.162.1 handles hook trust, first through strings in its binary and
  then by reading `~/.codex/config.toml` and its README. The session's auto-mode permission classifier refused both
  as "Security Weaken", so I stopped probing. The result file (the "Codex trust spike result" section in
  `issues/m6-05-state-from-each-engine-s-hooks-with-the.md`) says **not run**. That is not "neither path works", so the
  fallback branch does not apply.
- **Built and tested:** `codexHookArgs` in `core/src/hooks/install.ts` emits one
  `-c hooks.<Event>=[{hooks=[{type="command",command="node \"<core>/event.js\" codex.<Event> --session <id>"}]}]`
  per declared event. It never edits `config.toml` and never uses `--dangerously-bypass-hook-trust`.
  - The state mapping is: `codex.PermissionRequest` to `waiting_for_you`, `codex.Stop` to `done`, `codex.Interrupt`
    to `idle`, `codex.SessionStart` to the `native_id` link (and `starting` to `idle`).
- **Test** `core/test/m6-05-hook-state.test.ts`, "M6-05a ...". A real isolated core launches an engine that declares
  `hooks: {kind: 'codex-config'}`. The test pulls the hook commands out of the argv the engine actually received and
  runs them through a shell:
  - `waiting_for_you` arrives within 2 s of PermissionRequest.
  - A `core.activity quiet` during the approval leaves it `waiting_for_you`, so it never shows `done` while the
    approval prompt is up.
  - `done` arrives within 2 s of Stop, and `idle` follows Interrupt.
  - Passes.
- **Turned off for the shipped Codex engine.** The built-in codex entry in `core/src/engines/registry.ts` has no
  `hooks` field, so real Codex sessions still use the notify path. A test pins that. Turning it on is a one-line
  change after the spike (see Left for Wasif).

### M6-05b (Gemini): MET against a fake engine; not yet run against the real `gemini` CLI

- `engines/gemini.json` now has `state_source: "hooks"` and
  `hooks: {kind: "gemini-system-settings", events: [SessionStart, BeforeAgent, AfterTool, Notification, AfterAgent]}`.
- At launch, `sessionHookEnv` writes `~/.metatrooper/engines/gemini/<session>.json`, holding only `{"hooks": ...}`, and
  sets `GEMINI_CLI_SYSTEM_SETTINGS_PATH` to it. The file is deleted when the session becomes `exited`
  (`removeSessionFiles`), and `sweepSessionFiles` removes leftovers at the next launch.
- The mapping follows Gemini CLI 0.63.0's bundled `docs/hooks/reference.md`:
  - Notification to `waiting_for_you`, AfterAgent to `done`, SessionStart to the `native_id` link.
  - BeforeAgent and AfterTool map to `working`, so a session leaves a permission wait when the tool runs. The spec
    only names the other three events.
  - I checked the bundle: hooks are on by default (`enableHooks ?? true`), and `GEMINI_CLI_SYSTEM_SETTINGS_PATH` is
    read at `chunk-2V7FO5QV.js:253310`.
- **Test** "M6-05b ...". It covers:
  - the env var reaching the engine and the file holding exactly our hooks;
  - each hook command run through a shell, with `native_id` = `gem-native-1`;
  - idle, then working, then `waiting_for_you`, then working, then `done`, each within 2 s;
  - no prompt, reply or tool text in the stored payloads;
  - after the engine exits, the session reaches `exited` and the per-session file is gone;
  - a pre-made `~/.gemini/settings.json` byte-identical afterwards.
  - Passes.

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
  and no hold after a finished wait), plus a version-gating test. All pass.

## Contracts changed

- `contracts/events-and-hooks.md`:
  - new event kinds and payload allowlists;
  - Gemini and Codex rows in the linking table;
  - new state rows and the permission-wait rule;
  - `claude.SessionEnd` mapped to `idle`;
  - the Claude event list with version gates;
  - a new "Codex and Gemini hooks" section;
  - spool kinds.
- `contracts/plugin-manifest.schema.json`: a new `hooks` property on engine entries (`kind`, `events`).

## Tests run

| Command | Result |
|---|---|
| `cd core && node --test test/m6-05-hook-state.test.ts` | 8 tests, 8 pass |
| `cd core && node --test "test/*.test.ts"` (first run) | 409 tests: 404 pass, 1 fail, 4 skipped. The failure was `session-config.test.ts` pinning the old Claude event list; I updated its expected lists |
| `cd core && node --test "test/*.test.ts"` (after the fix) | 409 tests, 405 pass, 0 fail, 4 skipped |
| `cd workbench && npm test` | 129 tests, 90 pass, 0 fail, 35 skipped (Electron E2E needs `METATROOPER_UI_REVISION_E2E=1`), 4 todo |

Setup: `npm ci` in `core` and `workbench`. node-pty's held scripts (`scripts/prebuild.js`, `scripts/post-install.js`)
were run by hand in `core`. `core/dist` was rebuilt with `node core/build.ts`; only `dist/redact.js` changed among the
tracked dist files, and it went in the same commit.

## Left for Wasif

1. **Run the Codex trust spike.** The steps are in the issue file. If path 1 passes, add
   `hooks: { kind: 'codex-config', events: ['SessionStart', 'PermissionRequest', 'Stop', 'Interrupt'] }` to the codex
   entry in `core/src/engines/registry.ts`, then update the pinning test in `m6-05-hook-state.test.ts` and the
   contract note. Also check:
   - that Codex accepts the event name `Interrupt` (drop it if not);
   - that the inline-table shape `[{hooks=[{type="command",command=...}]}]` is what Codex expects;
   - that a Codex hook's `session_id` is the rollout thread id. If it is not, every hook event is treated as a side
     thread and changes no state.
   If neither trust path works, the fallback branch needs title or bell timing and a Known limits entry; nothing for
   that is built.
2. **Live checks not done here.** Run one real `gemini` session and one real Claude permission prompt through a
   MetaTrooper launch. Gemini runs hooks "with a sanitized environment", so the session id travels on the command
   line (`--session`). event.js still needs to find `troop.db` through the default `~/.metatrooper` or a
   `METATROOPER_HOME` that survives that sanitizing. I did not check whether Claude's PermissionRequest input carries
   `tool_use_id`; without it the code falls back to the last PreToolUse.
3. **Gemini system settings are shadowed.** `GEMINI_CLI_SYSTEM_SETTINGS_PATH` replaces Gemini's system settings file,
   so a machine-wide one (for example `C:\ProgramData\gemini-cli\settings.json`) is ignored for MetaTrooper-launched
   sessions. Merging it into the per-session file would fix that; I did not build it.
4. **Process conflicts in the issue file.** It says "Never commit ... from an agent" and "Codex writes the tests"
   (D65). Your instructions for this run said to commit and to write the tests, so I followed them. These tests were
   written by Claude, not Codex, and no mutation run was done.
5. **Spec bullets in "Sessions and state" outside M6-05a/b/c were not built:** waiting `reason`/`since` and
   `state_titles`. I read them as belonging to other children (M6-9, M6-23).
