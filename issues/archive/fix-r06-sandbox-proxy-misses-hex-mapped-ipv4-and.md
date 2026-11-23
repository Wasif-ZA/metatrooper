# FIX-R6: Sandbox proxy misses hex-mapped IPv4 and other private ranges

From the 2026-10-31 audit of router, plugins, sandbox, release. Severity: Medium. Effort: S unless the fix says otherwise.

## Where

- sandbox/proxy.js:10-18; plugins/agent-reach/bin/safe-fetch.js:6-7

## What goes wrong

isPrivate recurses only on dotted `::ffff:` forms. Reproduced false for ::ffff:7f00:1 (127.0.0.1), 64:ff9b::7f00:1, 2002:7f00:1::, fec0::1 and 198.18.0.1. Needs DNS control of an allowed host to exploit. safe-fetch handles hex-mapped but misses NAT64, 6to4 and 198.18/15.

## Fix

Use net.BlockList as safe-fetch does and add 64:ff9b::/96, 2002::/16, fec0::/10, 198.18.0.0/15, 192.0.0.0/24 in both.

## Audit

Read-only audit, 2026-10-31. 11 of 12 findings reproduced in scratch, never in the repo. Tests: router pytest 450 passed, 1 skipped, 0 failed on Python 3.12 (test_ab.py deselected as work in progress). Python 3.14 has no pytest.

## Acceptance criteria

- [ ] FIX-R6a. isPrivate is true for all five addresses above.
- [ ] FIX-R6b. It is false for a public v4 and a public v6.
- [ ] FIX-R6c. A selftest or unit test covers them.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
