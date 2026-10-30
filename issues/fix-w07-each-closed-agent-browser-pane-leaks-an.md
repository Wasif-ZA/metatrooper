# FIX-W7: Each closed agent browser pane leaks an Electron session

From the 2026-10-31 audit of workbench. Severity: Low. Effort: S unless the fix says otherwise.

## Where

- workbench/src/browser/panes.ts:250-254, 634-654

## What goes wrong

Agent panes get a unique partition that is added to `guarded` and never removed; destroy() clears storage but the session and its handlers live until exit.

## Fix

Remove the partition and its handlers in destroy() for agent panes.

## Audit

Read-only audit of workbench, 2026-10-31. `npm test`: 282 tests, 244 pass, 0 fail, 34 skipped (real-Electron tests behind METATROOPER_UI_REVISION_E2E=1), 4 todo; no finding below is covered by a running test.

## Acceptance criteria

- [ ] FIX-W7a. After closing N agent panes, guarded.size and the live session count do not grow with N.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
