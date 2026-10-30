# FIX-R4: Read hook sets permissionDecision allow on every rewrite

From the 2026-10-31 audit of router, plugins, sandbox, release. Severity: Medium. Effort: S unless the fix says otherwise.

## Where

- router/metarouter/hook.py:34-50, 76-87

## What goes wrong

Rewriting a Read (an image, or a file of 12,000 bytes or more with no limit) also returns `permissionDecision: allow`, which may skip Claude Code's permission prompt for a file outside allowed folders. The Bash side sets no decision on purpose. Not run against Claude Code; check its hook docs first.

## Fix

Return only updatedInput from the Read branch.

## Audit

Read-only audit, 2026-10-31. 11 of 12 findings reproduced in scratch, never in the repo. Tests: router pytest 450 passed, 1 skipped, 0 failed on Python 3.12 (test_ab.py deselected as work in progress). Python 3.14 has no pytest.

## Acceptance criteria

- [ ] FIX-R4a. Read hook output has no permissionDecision.
- [ ] FIX-R4b. The 300-line limit and image shrink still apply.
- [ ] FIX-R4c. test_hook.py asserts no decision.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
