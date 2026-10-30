# FIX-C7: engines.check can crash the core through an unhandled rejection

From the 2026-10-31 audit of core. Severity: Low. Effort: S unless the fix says otherwise.

## Where

- core/src/methods.ts:449

## What goes wrong

`void checkAll(...)` has no catch. A SQLITE_BUSY inside checkAll rejects, and the process log handler calls process.exit(1) with no cleanup. Verified 2026-10-31.

## Fix

`void checkAll(...).catch(() => {})`.

## Audit

Read-only audit of core/src, 2026-10-31. Tests at audit time: `node --test "test/*.test.ts"` in core, 726 tests, 715 pass, 0 fail, 11 skipped.

## Acceptance criteria

- [ ] FIX-C7a. With checkAll stubbed to reject, engines.check returns {} and the core stays up.
- [ ] FIX-C7b. A test asserts no unhandled rejection.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
