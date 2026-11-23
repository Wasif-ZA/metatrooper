# FIX-R10: json-set rewrites LF files as CRLF on Windows

From the 2026-10-31 audit of router, plugins, sandbox, release. Severity: Low. Effort: S unless the fix says otherwise.

## Where

- router/metarouter/recipes/json_set.py:33, 59

## What goes wrong

read_text and write_text translate newlines; reproduced by byte dump. Shows as a whole-file git diff.

## Fix

Open both ends with newline="" and keep the file's own line endings.

## Audit

Read-only audit, 2026-10-31. 11 of 12 findings reproduced in scratch, never in the repo. Tests: router pytest 450 passed, 1 skipped, 0 failed on Python 3.12 (test_ab.py deselected as work in progress). Python 3.14 has no pytest.

## Acceptance criteria

- [ ] FIX-R10a. An LF file stays LF and a CRLF file stays CRLF.
- [ ] FIX-R10b. A test asserts the raw bytes.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
