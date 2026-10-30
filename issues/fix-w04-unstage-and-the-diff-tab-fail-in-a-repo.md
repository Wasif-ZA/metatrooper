# FIX-W4: Unstage and the Diff tab fail in a repo with no commits

From the 2026-10-31 audit of workbench. Severity: Low. Effort: S unless the fix says otherwise.

## Where

- workbench/src/gitpane.ts:87; src/main.ts:467-480; src/handback.ts:34

## What goes wrong

Reproduced with git 2.54: `git restore --staged` and `git diff HEAD` both exit 128 when HEAD does not exist, though gitView supports "No commits yet".

## Fix

Detect the unborn branch; unstage with `git rm --cached -r --`, diff against the empty tree.

## Audit

Read-only audit of workbench, 2026-10-31. `npm test`: 282 tests, 244 pass, 0 fail, 34 skipped (real-Electron tests behind METATROOPER_UI_REVISION_E2E=1), 4 todo; no finding below is covered by a running test.

## Acceptance criteria

- [ ] FIX-W4a. In a repo with no commits, Unstage and Unstage all work.
- [ ] FIX-W4b. The Diff tab lists staged and untracked files instead of an error.
- [ ] FIX-W4c. A gitpane test runs in a fresh git init repo.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
