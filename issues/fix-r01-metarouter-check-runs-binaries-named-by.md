# FIX-R1: metarouter check runs binaries named by untrusted repo recipes

From the 2026-10-31 audit of router, plugins, sandbox, release. Severity: High. Effort: S unless the fix says otherwise.

## Where

- router/metarouter/cli.py:717-719; versions.py:15-39

## What goes wrong

check builds the binary map from every recipe, untrusted ones included, and runs `<exe> --version` on each before the trust skip at cli.py:743. Reproduced: an untrusted recipe naming ./evil.bat wrote a marker file during `metarouter check`.

## Fix

Build the binary map only from trusted recipes (or under --project).

## Audit

Read-only audit, 2026-10-31. 11 of 12 findings reproduced in scratch, never in the repo. Tests: router pytest 450 passed, 1 skipped, 0 failed on Python 3.12 (test_ab.py deselected as work in progress). Python 3.14 has no pytest.

## Acceptance criteria

- [ ] FIX-R1a. check without --project spawns nothing for an untrusted project recipe, with or without --changed.
- [ ] FIX-R1b. A test repo with an untrusted recipe naming ./evil.cmd leaves no marker.
- [ ] FIX-R1c. check --project still runs project recipes.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
