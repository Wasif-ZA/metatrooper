# FIX-R2: repo plugin diff: git option injection through base

From the 2026-10-31 audit of router, plugins, sandbox, release. Severity: Medium. Effort: S unless the fix says otherwise.

## Where

- plugins/repo/bin/repo.js:80-83, 100

## What goes wrong

input.base goes straight into `git diff --stat <base>` with no `--`. Reproduced: base `--output=<path>` made git write the patch to that path and the action replied ok.

## Fix

Refuse a base starting with `-` and add --end-of-options, or resolve it with rev-parse --verify.

## Audit

Read-only audit, 2026-10-31. 11 of 12 findings reproduced in scratch, never in the repo. Tests: router pytest 450 passed, 1 skipped, 0 failed on Python 3.12 (test_ab.py deselected as work in progress). Python 3.14 has no pytest.

## Acceptance criteria

- [ ] FIX-R2a. base `--output=x` returns ok:false and writes nothing.
- [ ] FIX-R2b. base main and HEAD~1 still work.
- [ ] FIX-R2c. A unit test covers an option-like base.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
