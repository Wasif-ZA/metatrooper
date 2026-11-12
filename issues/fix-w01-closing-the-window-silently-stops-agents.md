# FIX-W1: Closing the window silently stops agents in other projects

From the 2026-10-31 audit of workbench. Severity: High. Effort: S unless the fix says otherwise.

## Where

- workbench/src/main.ts:788-809; src/queries.ts:135-143

## What goes wrong

busy() looks only at lastGood.sessions, which holds the selected project's sessions. With project A shown and an agent working or waiting in project B, closing a window that started the core skips the "Agents are still open" dialog and stops the core and every agent. Verified 2026-10-31.

## Fix

Count every non-exited session in every project.

## Audit

Read-only audit of workbench, 2026-10-31. `npm test`: 282 tests, 244 pass, 0 fail, 34 skipped (real-Electron tests behind METATROOPER_UI_REVISION_E2E=1), 4 todo; no finding below is covered by a running test.

## Acceptance criteria

- [x] FIX-W1a. With project A selected and an agent working in B, closing shows the Keep / Stop / Cancel dialog.
- [x] FIX-W1b. With no project selected and any agent running, closing shows the dialog.
- [x] FIX-W1c. A test covers busy() across two projects.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
