# FIX-C8: Unlinked Codex and agy sessions rescan the disk every second

From the 2026-10-31 audit of core. Severity: Low. Effort: S unless the fix says otherwise.

## Where

- core/src/sessions/watch.ts:73-85, 117-163; main.ts:134

## What goes wrong

If a rollout file or brain folder is never found, a full synchronous walk of ~/.codex/sessions (or a stat of every brain folder) repeats every tick with no backoff. Cost not measured.

## Fix

Back off per session (every 10 s after 30 s unlinked) or cache the listing.

## Audit

Read-only audit of core/src, 2026-10-31. Tests at audit time: `node --test "test/*.test.ts"` in core, 726 tests, 715 pass, 0 fail, 11 skipped.

## Acceptance criteria

- [ ] FIX-C8a. A Codex session with no rollout walks at most once per back-off period (counting readdirSync spy).
- [ ] FIX-C8b. Linking still happens within 1 s when the file appears early.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
