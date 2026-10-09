# M5-5 Linux: source install beta at launch

Child of Milestone 5 in `spec.md`. Tag: BLOCKER for the beta (0.5 CC days); packaged Linux is M5 work in December (1.5 CC days).
Decided M5-D4.

## Current state, verified 2026-10-09

- Core tests pass on Linux (M1-STATUS iteration 3, unix sockets); the workbench is untested there.
- `core/src/secrets.ts:14-23` always spawns `powershell` for plugin secrets (faked only with
  `METATROOPER_FAKE_DPAPI=1`, `:11-13`). `core/src/settings.ts:33` defaults the shell tab to `pwsh.exe`. The
  launcher is `.ps1` only. spec Out of scope says macOS and Linux are not tested.

## What to build at launch

1. Secrets on Linux: `secret-tool` (libsecret) when present, otherwise a `0600` file under `~/.metatrooper/secrets/`
   with a warning on the plugin screen.
2. Default shell tab `bash` when not on Windows.
3. `workbench/bin/metatrooper.sh`, the Linux twin of `metatrooper.cmd`.
4. README "Linux (beta, from source)": clone, `npm ci` in core and workbench, run.
5. One pass of both suites on Ubuntu 24.04; failures listed in this file.

## After launch

AppImage and `.deb` targets in M5-1's packager, plus the opt-in Electron suites on Linux.

## Acceptance criteria

- M5-05a. On Ubuntu 24.04 the core suite passes and a plugin secret round-trips through `secret-tool`.
- M5-05b. From a fresh clone, the README steps open the window and a claude agent reaches its prompt.
