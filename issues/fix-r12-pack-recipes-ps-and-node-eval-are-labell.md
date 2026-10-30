# FIX-R12: Pack recipes ps and node-eval are labelled read

From the 2026-10-31 audit of router, plugins, sandbox, release. Severity: Low. Effort: S unless the fix says otherwise.

## Where

- router/metarouter/packs/windows-shell.json; node-npm.json

## What goes wrong

Both run arbitrary code from an argument but carry the default purity read.

## Fix

Mark both write (or external).

## Audit

Read-only audit, 2026-10-31. 11 of 12 findings reproduced in scratch, never in the repo. Tests: router pytest 450 passed, 1 skipped, 0 failed on Python 3.12 (test_ab.py deselected as work in progress). Python 3.14 has no pytest.

## Acceptance criteria

- [ ] FIX-R12a. Both carry a non-read purity.
- [ ] FIX-R12b. A catalog test fails if a powershell -Command or node -p/-e body is labelled read.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
