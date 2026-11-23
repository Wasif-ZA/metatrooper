# M5-1 Installer and bundled runtime

Child of Milestone 5 in `spec.md` (Milestone 5: launch). Tag: BLOCKER (ships 2026-12-01). Effort 3.75 CC days (worked below).

## Current state, verified 2026-10-09

- No installer of any kind. `workbench/package.json:10-12` has only `dev` (`electron .`) and `test`; no packager in
  devDependencies (`:14-16`). `workbench/bin/install-launcher.ps1:3` and `bin/metatrooper.cmd:2` run
  `node_modules\electron\dist\electron.exe` from a git clone. Icons exist (`workbench/build/icon.ico`).
- The app needs the user's own Node 24 in three places: `workbench/src/main.ts:620` spawns `'node'` for the core;
  `core/src/hooks/install.ts:30` writes `node "<eventScript>"` into `~/.claude/settings.json`; `install.ts:164` and
  `:174` do the same for Codex notify. README.md:183 lists Node 24.16 as a prerequisite.
- `troop hooks uninstall [--codex]` exists (`core/cli.ts:98-105`) and is byte-identical (M1-13).
- spec.md Out of scope lists auto-update.

## What to build

1. Packager: electron-builder, NSIS per-user target (no admin prompt). It is under the 25k-star dependency gate
   (M5-D12 grants the exception, as xterm got one). Bundle `core/`, `plugins/`, `pipelines/`, `skills/`,
   `contracts/`; node-pty unpacked from asar; product name MetaTrooper, `workbench/build/icon.ico`, install path
   `%LOCALAPPDATA%\Programs\MetaTrooper`.
2. No user Node: the core and every hook run under the bundled Electron with `ELECTRON_RUN_AS_NODE=1`. First check
   that `node:sqlite` and node-pty load there (a one-line probe script in `tests/windows/`); if `node:sqlite` is
   missing, ship a signed `node.exe` next to the app instead and record which in this file.
3. Hook commands point at a fixed shim, `%LOCALAPPDATA%\MetaTrooper\bin\troop-hook.cmd`, that resolves the current
   install, so an app update never leaves `~/.claude/settings.json` pointing at a deleted folder. Same shim folder
   holds `troop.cmd` for the agent skill.
4. Uninstaller: runs `troop hooks uninstall --codex --yes` before deleting files; removes the PATH entry and
   shortcuts `install-launcher.ps1` writes (`:7-20`); offers (unticked) to delete `~/.metatrooper/` and its
   worktrees.
5. Update stance: no auto-update and no update check (an update check is a network call, spec "Open core"). A new
   version is a new installer. The installer refuses to install an older version over a `troop.db` whose
   `PRAGMA user_version` is newer than the build knows.

## Acceptance criteria

- M5-01a. On a fresh Windows account with Smart App Control on and no Node on PATH, the signed installer (M5-2)
  installs without an admin prompt, the window opens, and a claude agent launched from the wall reaches its prompt
  within 30 s (this is UI-02).
- M5-01b. After install, `~/.claude/settings.json` hook commands contain the shim path and no versioned folder.
- M5-01c. Uninstall leaves `~/.claude/settings.json` and `~/.codex/config.toml` byte-identical to before install
  (compare SHA-256 of copies taken before install).
- M5-01d. Installing 0.1.0 over a `troop.db` with a higher `user_version` stops with a message and changes nothing.

## Effort, worked

Config 0.75 + bundling with node-pty unpacked 0.5 + name, icon, per-user path 0.25 + no user Node 1.0 + uninstaller
0.5 + update stance and downgrade refusal 0.25 + clean-machine script 0.5 = 3.75 CC days.

## Hand-back

A fresh Windows account or VM with Smart App Control on, to run M5-01a.
