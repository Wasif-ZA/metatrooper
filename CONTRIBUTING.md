# Contributing

Windows first, Linux beta, from source. Local only: no account, no telemetry.

## Before you write code

Open an issue first for anything bigger than a typo, so we can agree on the shape. `spec.md` holds every decision
and the reason for it; `contracts/` holds the exact formats. If your change moves a contract, change the contract
file in the same pull request.

## Setup

Node 24.16 or newer, Windows (Linux is beta).

```bash
cd core && npm ci
cd ../workbench && npm ci
```

## Tests

```bash
cd core && METATROOPER_FAKE_DPAPI=1 npm test
cd workbench && npm test
```

Run one file while you work: `node --test test/<file>.test.ts`. A bug fix comes with a test that fails without it.
No test may reach the network.

Some suites need a real desktop and are off by default:

- `METATROOPER_UI_REVISION_E2E=1` runs the Electron window tests.
- `METATROOPER_DESKTOP_E2E=1` runs the computer-use tests that drive real Windows apps. They need the desktop to
  themselves; do not touch the mouse or keyboard while they run.

Never point a test at your real `~/.metatrooper`. Use `METATROOPER_HOME` with a temp folder, or `npm run dev -- --demo`
in `workbench/` for a throwaway copy of the app.

## Style

- Match the code around you: the same naming, the same few one-line comments.
- No new dependency without a reason in the pull request. A dependency must be well maintained and widely used.
- Plain words in docs and UI text. Dates as `2026-10-10T20:00+11:00`.

## Licence

The core and workbench are AGPL-3.0; the SDK, contracts' public formats, plugins, skills, engine files and `router/`
are MIT (see the licence map in the README). By sending a pull request you agree your change is released under the
licence of the folder it touches.
