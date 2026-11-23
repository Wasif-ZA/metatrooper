# FIX-C5: worktree.create can return the wrong branch as existing

From the 2026-10-31 audit of core. Severity: Low. Effort: S unless the fix says otherwise.

## Where

- core/src/methods.ts:459-466

## What goes wrong

The folder name replaces `/` with `-`, so `feat/x` and `feat-x` share a folder. With `feat-x` checked out, a request for `feat/x` returns `existing:true, branch:'feat/x'` and the agent commits on the wrong branch. Folder naming verified 2026-10-31.

## Fix

On the existing path, read the checked-out branch and refuse with -32003 when it differs.

## Audit

Read-only audit of core/src, 2026-10-31. Tests at audit time: `node --test "test/*.test.ts"` in core, 726 tests, 715 pass, 0 fail, 11 skipped.

## Acceptance criteria

- [ ] FIX-C5a. worktree.create feat-x then feat/x returns -32003 or a different folder.
- [ ] FIX-C5b. worktree.create feat-x twice returns existing:true with the same branch.
- [ ] FIX-C5c. A test covers both.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
