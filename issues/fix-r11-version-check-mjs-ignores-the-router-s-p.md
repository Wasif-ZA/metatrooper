# FIX-R11: version-check.mjs ignores the router's pyproject version

From the 2026-10-31 audit of router, plugins, sandbox, release. Severity: Low. Effort: S unless the fix says otherwise.

## Where

- tests/version-check.mjs:12-17; router/pyproject.toml

## What goes wrong

Only package.json and troop-plugin.json are compared, so the PyPI version can drift and the gate still passes.

## Fix

Read the pyproject version and compare it too.

## Audit

Read-only audit, 2026-10-31. 11 of 12 findings reproduced in scratch, never in the repo. Tests: router pytest 450 passed, 1 skipped, 0 failed on Python 3.12 (test_ab.py deselected as work in progress). Python 3.14 has no pytest.

## Acceptance criteria

- [ ] FIX-R11a. Changing only the pyproject version fails the check.
- [ ] FIX-R11b. The check passes when all are 0.1.0.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
