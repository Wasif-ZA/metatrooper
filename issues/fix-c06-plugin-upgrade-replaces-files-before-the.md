# FIX-C6: Plugin upgrade replaces files before the database write, with no rollback

From the 2026-10-31 audit of core. Severity: Low. Effort: S unless the fix says otherwise.

## Where

- core/src/plugins/store.ts:178-199, 236-253

## What goes wrong

placeFiles swaps in the new folder and deletes the old copy before the transaction. A SQLITE_BUSY at the 200 ms busy timeout leaves new unapproved code on disk while the database keeps the old manifest and permissions.

## Fix

Run the transaction first, or keep the old copy until commit and restore it on failure.

## Audit

Read-only audit of core/src, 2026-10-31. Tests at audit time: `node --test "test/*.test.ts"` in core, 726 tests, 715 pass, 0 fail, 11 skipped.

## Acceptance criteria

- [ ] FIX-C6a. With a forced throw inside the transaction, the plugin folder is byte-identical to before.
- [ ] FIX-C6b. No .old-* or .staging-* folder is left behind.
- [ ] FIX-C6c. A successful upgrade removes the old copy.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
