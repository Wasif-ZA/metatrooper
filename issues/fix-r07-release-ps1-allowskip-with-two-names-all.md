# FIX-R7: release.ps1 -AllowSkip with two names allows neither

From the 2026-10-31 audit of router, plugins, sandbox, release. Severity: Medium. Effort: S unless the fix says otherwise.

## Where

- tests/release.ps1:3-4, 69-70

## What goes wrong

With -File, `-AllowSkip docker,network` arrives as one string. Reproduced: count=1 first=docker,network, so the release gate fails suites meant to be allowed.

## Fix

Split each element on commas after param.

## Audit

Read-only audit, 2026-10-31. 11 of 12 findings reproduced in scratch, never in the repo. Tests: router pytest 450 passed, 1 skipped, 0 failed on Python 3.12 (test_ab.py deselected as work in progress). Python 3.14 has no pytest.

## Acceptance criteria

- [ ] FIX-R7a. -AllowSkip docker,network marks both suites allowed.
- [ ] FIX-R7b. -AllowSkip docker still works.
- [ ] FIX-R7c. The usage comment matches.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
