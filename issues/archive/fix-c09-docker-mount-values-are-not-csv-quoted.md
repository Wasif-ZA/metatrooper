# FIX-C9: Docker --mount values are not CSV-quoted

From the 2026-10-31 audit of core. Severity: Low. Effort: S unless the fix says otherwise.

## Where

- core/src/sandbox/launch.ts:46

## What goes wrong

Docker parses --mount as CSV, so a path with a comma breaks the launch, and a crafted folder name could add mount keys. Read from code; docker not run.

## Fix

Quote source and target inside the field, or refuse paths with a comma or quote.

## Audit

Read-only audit of core/src, 2026-10-31. Tests at audit time: `node --test "test/*.test.ts"` in core, 726 tests, 715 pass, 0 fail, 11 skipped.

## Acceptance criteria

- [ ] FIX-C9a. A worktree path with a comma round-trips through a CSV parser unchanged, or the launch is refused with a clear message.
- [ ] FIX-C9b. A test covers it.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
