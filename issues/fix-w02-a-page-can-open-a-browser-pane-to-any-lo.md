# FIX-W2: A page can open a browser pane to any loopback port

From the 2026-10-31 audit of workbench. Severity: Medium. Effort: S unless the fix says otherwise.

## Where

- workbench/src/browser/panes.ts:308, 357-368; src/main.ts:651-657; core/src/methods.ts:577

## What goes wrong

A public page in a user pane calls window.open('http://127.0.0.1:8080/...') after any click. The handler checks only http(s), pane.open stores the url, and create() seeds the typed-port set from the row url, so the loopback port counts as typed by the user and the request goes through (contracts/browser-tools.md:204).

## Fix

Seed typed ports only from userNavigate, never from the row url.

## Audit

Read-only audit of workbench, 2026-10-31. `npm test`: 282 tests, 244 pass, 0 fail, 34 skipped (real-Electron tests behind METATROOPER_UI_REVISION_E2E=1), 4 todo; no finding below is covered by a running test.

## Acceptance criteria

- [ ] FIX-W2a. window.open to 127.0.0.1:PORT from a page gets a blocked page.
- [ ] FIX-W2b. A URL typed in the URL box still reaches its loopback port.
- [ ] FIX-W2c. A pane restored after restart is not granted its last page's loopback port.
- [ ] FIX-W2d. A test covers the window.open path.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
