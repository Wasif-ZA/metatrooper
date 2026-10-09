# M5-9 Release gate, CI, versioning

Child of Milestone 5 in `spec.md`. Tag: BLOCKER (ships 2026-12-01). Effort 1.75 CC days (1.0 + 0.75).

## Current state, verified 2026-10-09

- 57 workbench e2e tests are opt-in (`METATROOPER_BROWSER_E2E`, `METATROOPER_UI_REVISION_E2E`); the Docker boundary
  test needs `METATROOPER_DOCKER_E2E=1`; desktop e2e needs `METATROOPER_DESKTOP_E2E=1`.
- `workbench/test/review-bar.test.ts` "auto-opens once" fails on main (30 s timeout), and it is the Pro screen.
- `tests/helpers/kill-tree.ts` is not built (M4-2); `core/test/helpers.ts` still holds the taskkill code.
- Versions are 0.1.0 in `workbench/package.json:3` and `core/package.json:3`, but `plugins/repo/package.json` says
  1.0.0. No git tags, no CHANGELOG, no `.github/`.

## What to build

1. `tests/release.ps1`: runs the core suite, the workbench suite and every opt-in suite one after another, then
   `tests/windows/listeners.ps1`; prints one PASS or FAIL line per suite and exits non-zero on any FAIL. Skipped
   suites (whisper missing, no Docker) print a loud SKIPPED line and count as FAIL unless `-AllowSkip <name>`.
2. Fix the review-bar "auto-opens once" case.
3. `tests/helpers/kill-tree.ts` shared by both suites (M4-2).
4. One version source: root `package.json` `version`; a check that every `package.json` and `troop-plugin.json`
   matches it.
5. `CHANGELOG.md` (Keep a Changelog headings).
6. `.github/workflows/ci.yml`: both default suites on `windows-latest` and `ubuntu-24.04` on every push to main.
   A release build that makes the installer and SHA-256 checksums as a draft release; signing (M5-2) and
   publishing stay Wasif's.

## Acceptance criteria

- M5-09a. Procedure: fresh clone of the tagged commit into an empty folder, `npm ci` in `core/` and `workbench/`,
  `METATROOPER_HOME` pointed at an empty temp folder, no core or window running, then `tests/release.ps1` twice.
  Both runs exit 0 and `listeners.ps1` prints `count=0` after each. Evidence: both console logs saved under
  `tests/release-logs/<version>/` and their last lines pasted into the release notes.
- M5-09b. Changing one plugin's version makes the version check fail.
- M5-09c. CI is green on both operating systems for the commit tagged `v0.1.0`.
