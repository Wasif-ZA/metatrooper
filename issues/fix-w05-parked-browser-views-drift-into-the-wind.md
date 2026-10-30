# FIX-W5: Parked browser views drift into the window after a resize

From the 2026-10-31 audit of workbench. Severity: Low. Effort: S unless the fix says otherwise.

## Where

- workbench/src/browser/panes.ts:664-683; src/main.ts:598-661

## What goes wrong

Hidden panes park as 1x1 views at the bottom-right corner computed at the last layout(). Nothing calls layout() on window resize, so after enlarging the window each parked view (page and overlay) sits mid-window and takes clicks on that pixel.

## Fix

Call layout() on resize, or park at a fixed off-screen point.

## Audit

Read-only audit of workbench, 2026-10-31. `npm test`: 282 tests, 244 pass, 0 fail, 34 skipped (real-Electron tests behind METATROOPER_UI_REVISION_E2E=1), 4 todo; no finding below is covered by a running test.

## Acceptance criteria

- [ ] FIX-W5a. After enlarging the window with the Browser tab closed, no parked view is inside the content area.
- [ ] FIX-W5b. The shown pane still tracks its host on resize.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
