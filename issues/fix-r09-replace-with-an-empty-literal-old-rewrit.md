# FIX-R9: replace with an empty literal old rewrites the whole file

From the 2026-10-31 audit of router, plugins, sandbox, release. Severity: Low. Effort: S unless the fix says otherwise.

## Where

- router/metarouter/recipes/replace.py:78-84

## What goes wrong

Reproduced: `run replace b.txt "" X` turned `hello` into `XhXeXlXlXoX`. Rollback only covers .py, .json and .toml.

## Fix

Exit 2 when old is empty in literal mode.

## Audit

Read-only audit, 2026-10-31. 11 of 12 findings reproduced in scratch, never in the repo. Tests: router pytest 450 passed, 1 skipped, 0 failed on Python 3.12 (test_ab.py deselected as work in progress). Python 3.14 has no pytest.

## Acceptance criteria

- [ ] FIX-R9a. An empty literal old exits 2 and leaves the file unchanged.
- [ ] FIX-R9b. Regex mode is unchanged.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
