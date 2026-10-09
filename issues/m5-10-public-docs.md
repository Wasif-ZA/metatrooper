# M5-10 Public docs, licences, privacy, the ACU rule as a setting

Child of Milestone 5 in `spec.md`. Tag: BLOCKER (ships 2026-12-01). Effort 2.5 CC days (1.0 + 0.5 + 0.25 + 0.25 + 0.5).

## Current state, verified 2026-10-09

- README.md is stale: `:198` "There is no installer yet"; `:29` and `:314` say the wall is "being built now";
  `:268` "Five ship" (17 pipeline files exist); `:283` "Four plugins ship" (13 exist); `:245` says `ask` is the
  default (it is `contained` today, `ask` after M5-3).
- LICENSE files exist in `core/`, `workbench/`, `sdk/`, `pipelines/`, `contracts/`; none at the root or in
  `plugins/*/`; no third-party notices. `workbench/renderer/vendor/gsap.min.js:4-6` carries GreenSock's standard
  licence (not OSI); the fonts in `vendor/fonts/` carry no OFL text.
- `core/src/project.ts:32-36` and `core/src/sessions/launch.ts:36` hardcode the `work/ACU` path rule (D46, D48).
  The repo is public.

## What to build

1. README rewrite: quickstart for the installer; platforms (Windows, Linux beta); privacy; Pro; where logs are
   (M5-4); uninstall (M5-1); known limits (browser.hello trusts a self-reported pid; spool drops an unfinished last
   line; printFailure loses the last line after a core restart); the launch pipelines as built-ins and the rest as
   preview templates (M5-18). First three lines on every page: Windows and Linux, local, no account, no telemetry.
2. Root `LICENSE` (AGPL-3.0) and a licence map; `LICENSE` (MIT) in each plugin; `THIRD-PARTY-NOTICES.md` with
   Electron and Chromium, xterm, node-pty, GSAP, and the OFL fonts with their licence text.
3. GSAP: GSAP's standard licence has allowed free use in any project since 2025 (Webflow); confirm the current
   text in `vendor/gsap.min.js` permits redistribution inside an AGPL app. If it does not, replace the glide with
   CSS transitions.
4. Privacy section: what `workbench/test/no-network.test.ts` proves and how to rerun it; every plugin with
   `network` and where it sends; the wpad exception; Pro activation as the second exception (M5-7).
5. ACU rule as a setting (M5-D7): `sessions.ask_paths` (array, empty by default); `project.ts` and
   `sessions/launch.ts` read it instead of the literal; `ask_near_acu` becomes `ask_near_paths`. Wasif's own
   `~/.metatrooper/settings.json` gets `["<vault>/work/ACU"]`, so his behaviour does not change.
6. `.github/ISSUE_TEMPLATE/bug.yml` (version, OS, a `logs/` excerpt with secrets removed), `SECURITY.md` with a
   private contact, `CONTRIBUTING.md` one page.

## Acceptance criteria

- M5-10a. `grep -rn "work/ACU" core/src workbench/src` returns nothing; with `ask_paths` set to a folder, a session
  there starts in `ask` (the existing D46 tests pass against the setting).
- M5-10b. Every folder that ships code holds a LICENSE, and THIRD-PARTY-NOTICES names every vendored file under
  `workbench/renderer/vendor/`.
- M5-10c. No README line says the installer, the wall or the plugins are unbuilt.

## Hand-back

Decide what to scrub from the public repo (session counts in spec Context, ACU mentions in spec.md, M1-STATUS.md and
`ide-layer-research/`); pick the support channel and the security contact.
