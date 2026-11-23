# FIX-R3: A timed-out MCP tools/call is replayed on a fresh server

From the 2026-10-31 audit of router, plugins, sandbox, release. Severity: Medium. Effort: S unless the fix says otherwise.

## Where

- router/metarouter/mcp.py:281-316; mcp_daemon.py:60-70, 137-153

## What goes wrong

call_tool falls back to a new Session on ConnectionError, TimeoutError or OSError, including a 60 s timeout after the daemon already sent the call, or a server that crashed after acting. Send, create, delete and spend tools run twice.

## Fix

Fall back only when the daemon could not be reached; never replay a call already written.

## Audit

Read-only audit, 2026-10-31. 11 of 12 findings reproduced in scratch, never in the repo. Tests: router pytest 450 passed, 1 skipped, 0 failed on Python 3.12 (test_ab.py deselected as work in progress). Python 3.14 has no pytest.

## Acceptance criteria

- [ ] FIX-R3a. A fake server sleeping over 60 s on tools/call is invoked exactly once.
- [ ] FIX-R3b. A server that exits after acting is invoked once and the error returned.
- [ ] FIX-R3c. An unreachable daemon still falls back once.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
