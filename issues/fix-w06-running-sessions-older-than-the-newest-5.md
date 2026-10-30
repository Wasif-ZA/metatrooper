# FIX-W6: Running sessions older than the newest 50 vanish from the wall

From the 2026-10-31 audit of workbench. Severity: Low. Effort: S unless the fix says otherwise.

## Where

- workbench/src/queries.ts:141

## What goes wrong

The sessions query takes the 50 newest unhidden sessions, so an older session that is still working or waiting loses its tile and row (and FIX-W1's busy check).

## Fix

Always include non-exited sessions alongside the 50 newest.

## Audit

Read-only audit of workbench, 2026-10-31. `npm test`: 282 tests, 244 pass, 0 fail, 34 skipped (real-Electron tests behind METATROOPER_UI_REVISION_E2E=1), 4 todo; no finding below is covered by a running test.

## Acceptance criteria

- [ ] FIX-W6a. A running session older than the newest 50 still has a tile and a row.
- [ ] FIX-W6b. A test seeds 60 sessions with the oldest working.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
