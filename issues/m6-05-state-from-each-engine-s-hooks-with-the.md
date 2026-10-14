# M6-5: State from each engine's hooks, with the Codex trust spike

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical. Effort: 3.5 CC days. Depends on: M6-4.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-5, and every section that names M6-5.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-05a. A Codex session shows `waiting_for_you` within 2 s of a PermissionRequest and `done` within 2 s of Stop on the M1-12 fixtures, and never shows `done` while an approval prompt is on screen. Fallback branch, used only if the spike's result file says neither trust path works: `waiting_for_you` within 2 s of the approval prompt's title or bell, and the gap is in Known limits.
- [ ] M6-05b. A Gemini CLI session gets a `native_id` and shows `waiting_for_you` and `done` from its hooks; `~/.gemini/settings.json` is byte-identical afterwards and the per-session file is gone.
- [ ] M6-05c. A Claude session in a permission wait stays `waiting_for_you` through a PreToolUse for a different `tool_use_id`, and moves to `working` on the PostToolUse of the waited call.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.

## Codex trust spike result

Status: not run (2026-10-12). Neither trust path is recorded as working or failing yet, so M6-05a's fallback branch
does not apply and the built-in Codex engine keeps the notify path until this section says which path works.

- Codex installed: `codex-cli 0.162.1`; `codex features list` shows `hooks  stable  true`. No `codex hooks`
  subcommand is listed in `codex --help`.
- The agent building M6-5 tried to read Codex's hook-trust handling (strings in the binary, `~/.codex/config.toml`);
  the session's permission classifier refused both, so no live trust check was made.
- Ready for the spike: `codexHookArgs` in `core/src/hooks/install.ts` builds the `-c hooks.<Event>=...` overrides,
  and adding `hooks: { kind: 'codex-config', events: ['SessionStart', 'PermissionRequest', 'Stop', 'Interrupt'] }`
  to the codex entry in `core/src/engines/registry.ts` turns them on per launch.

To run it (path 1, hooks given by `-c` run with no trust prompt):

```
echo 'require("fs").writeFileSync("stop-fired.txt", "1")' > hook.js
codex -c 'hooks.Stop=[{hooks=[{type="command",command="node hook.js"}]}]' "say hi"
```

Pass when the TUI shows no hook trust prompt and `stop-fired.txt` appears after the reply. Also check that
`hooks.Interrupt` is an accepted event name (a rejected name must not stop Codex from starting); drop it from the
events list if not. If path 1 fails, look for a Codex command that records trust for a named hook (path 2). Never use
`--dangerously-bypass-hook-trust`.

## Gemini system settings check (2026-10-12)

The spec's Gemini path does not work on this Windows machine with Gemini CLI 0.63.0, so `engines/gemini.json`
declares no `hooks` yet. The mechanism (`sessionHookEnv`, kind `gemini-system-settings`) is built and tested
against a fake engine.

- `GEMINI_CLI_SYSTEM_SETTINGS_PATH` pointing at a settings file in a user-owned folder prints, on every launch:
  `Security Warning: Skipping system settings file '<file>': Parent directory '<dir>' is insecure: Directory '<dir>'
  is not owned by a trusted administrator or SYSTEM account. Current owner: DESKTOP-TSA6L47\User.` The file is
  skipped and no hook runs. `~/.metatrooper/engines/gemini/` is user-owned, so it fails the same check.
- The same run could not sign in at all: `IneligibleTierError: This client is no longer supported for Gemini Code
  Assist for individuals` (free tier, reason `UNSUPPORTED_CLIENT`). No live Gemini session is possible on this
  account.
- `~/.gemini/settings.json` was byte-identical after the run (sha256 checked).

Options for Wasif: an admin-owned folder for the per-session files (created once with an elevated step), a Gemini
extension holding MetaTrooper's hooks (lives under `~/.gemini/extensions/`, not `settings.json`, but is not per
session), or keep Gemini on process state.
