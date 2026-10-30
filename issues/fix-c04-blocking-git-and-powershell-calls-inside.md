# FIX-C4: Blocking git and PowerShell calls inside pipe handlers stall the whole core

From the 2026-10-31 audit of core. Severity: Medium. Effort: S unless the fix says otherwise.

## Where

- core/src/plugins/store.ts:69; sessions/owners.ts:20-21, 250-254; project.ts:56; secrets.ts:27-33

## What goes wrong

plugin.preview (no ui.hello needed) runs `git clone` synchronously with a 120 s timeout, freezing pty output, the 2 s heartbeat and every request. Any local process can also make the core clone any URL, and store.ts lacks the https-only protocol flags that importers.ts:306 uses. session.owners, project.open and the secrets cache miss block the same way for up to 5 s. Extends the worktree.create row in m7-06.

## Fix

Use async execFile in these handlers and give store.ts the importers.ts protocol flags.

## Audit

Read-only audit of core/src, 2026-10-31. Tests at audit time: `node --test "test/*.test.ts"` in core, 726 tests, 715 pass, 0 fail, 11 skipped.

## Acceptance criteria

- [ ] FIX-C4a. With a fake git that sleeps 30 s, core.ping answers in under 500 ms during plugin.preview.
- [ ] FIX-C4b. The heartbeat keeps advancing during the clone.
- [ ] FIX-C4c. git clone runs with the https-only protocol flags.
- [ ] FIX-C4d. plugin.preview of a git URL needs ui.hello, or the contract says why not.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
