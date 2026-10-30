# FIX-R5: Hook reads stdin as cp1252, corrupting non-ASCII commands

From the 2026-10-31 audit of router, plugins, sandbox, release. Severity: Medium. Effort: S unless the fix says otherwise.

## Where

- router/metarouter/hook.py:69

## What goes wrong

json.load(sys.stdin) decodes with the Windows locale. Reproduced: `cat café.txt` became `cat cafÃ©.txt`. Bytes undefined in cp1252 raise and the bare except silently skips the hook.

## Fix

Read sys.stdin.buffer and decode as UTF-8.

## Audit

Read-only audit, 2026-10-31. 11 of 12 findings reproduced in scratch, never in the repo. Tests: router pytest 450 passed, 1 skipped, 0 failed on Python 3.12 (test_ab.py deselected as work in progress). Python 3.14 has no pytest.

## Acceptance criteria

- [ ] FIX-R5a. A UTF-8 event with café or an emoji round-trips unchanged with PYTHONUTF8 unset.
- [ ] FIX-R5b. A test runs the hook with PYTHONUTF8 unset.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
