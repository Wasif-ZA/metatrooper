# Contributing

Windows and Linux (beta). Local only: no account, no telemetry.

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
No test may reach the network; `workbench/test/no-network.test.ts` checks this for the whole app.

## Style

- Match the code around you: the same naming, the same few one-line comments.
- No new dependency without a reason in the pull request. A dependency must be well maintained and widely used.
- Plain words in docs and UI text. Dates as `2026-10-10T20:00+11:00`.

## Licence

The core and workbench are AGPL-3.0; the SDK, contracts' public formats, pipelines, plugins, skills and engine files
are MIT (see the licence map in the README). By sending a pull request you agree your change is released under the
licence of the folder it touches.
