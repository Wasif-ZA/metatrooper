# FIX-C2: Any pipe client can launch a session with a looser approval profile

From the 2026-10-31 audit of core. Severity: Medium. Effort: S unless the fix says otherwise.

## Where

- core/src/methods.ts:201-241 (session.launch), :66

## What goes wrong

approval comes from the request and is checked only against the engine's declared profiles. An agent in an ask session can call `session.launch {approval:'contained'}` (Claude `--permission-mode auto`, Codex `--approve-for-me`) with its own prompt. The CLI documents `--approval` for humans, so the intent for agent callers needs his confirmation.

## Fix

For a connection without ui.hello, cap approval at the calling session's own level (parent_id or TROOP_SESSION_ID).

## Audit

Read-only audit of core/src, 2026-10-31. Tests at audit time: `node --test "test/*.test.ts"` in core, 726 tests, 715 pass, 0 fail, 11 skipped.

## Acceptance criteria

- [ ] FIX-C2a. A non-UI launch with parent_id of an ask session and approval contained returns -32012 or -32003.
- [ ] FIX-C2b. The same call over a ui.hello connection succeeds.
- [ ] FIX-C2c. A child at or below the parent's level still launches.
- [ ] FIX-C2d. A test covers all three.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
