# FIX-W8: Watch-layout thumbnail poll can pile up calls

From the 2026-10-31 audit of workbench. Severity: Low. Effort: S unless the fix says otherwise.

## Where

- workbench/renderer/app.js:1158-1175; src/main.ts:562-572

## What goes wrong

setInterval(refreshThumbs, 500) captures 480x300 thumbnails of every window each tick with no in-flight guard. Not measured.

## Fix

Skip a tick while a call is pending; capture only windows with grants.

## Audit

Read-only audit of workbench, 2026-10-31. `npm test`: 282 tests, 244 pass, 0 fail, 34 skipped (real-Electron tests behind METATROOPER_UI_REVISION_E2E=1), 4 todo; no finding below is covered by a running test.

## Acceptance criteria

- [ ] FIX-W8a. At most one desktopThumbs call is in flight at a time.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
