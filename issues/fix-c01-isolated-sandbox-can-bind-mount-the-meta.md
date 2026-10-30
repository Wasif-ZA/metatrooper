# FIX-C1: Isolated sandbox can bind-mount the MetaTrooper home read-write

From the 2026-10-31 audit of core. Severity: Medium. Effort: S unless the fix says otherwise.

## Where

- core/src/sandbox/launch.ts:30-43, :62-63

## What goes wrong

gitLayout checks only that gitdir sits somewhere under `<common>/worktrees` and that the back-pointer matches. A worktree whose `.git` says `gitdir: .`, with a root `commondir` of `../../..` and a root `gitdir` of `.git`, makes gitLayout return common = `~/.metatrooper` (reproduced by calling gitLayout). dockerArgv then binds it read-write into the isolated container; it holds ui.key, secrets/ and troop.db. The rewrite must come from outside an isolated session.

## Fix

Require `path.dirname(gitdir) === path.join(common, 'worktrees')` and `path.basename(common) === '.git'`.

## Audit

Read-only audit of core/src, 2026-10-31. Tests at audit time: `node --test "test/*.test.ts"` in core, 726 tests, 715 pass, 0 fail, 11 skipped.

## Acceptance criteria

- [ ] FIX-C1a. gitLayout refuses the crafted layout (gitdir = worktree, commondir `../../..`).
- [ ] FIX-C1b. gitLayout still accepts a real `git worktree add` layout.
- [ ] FIX-C1c. sandbox-selftest.test.ts covers the crafted layout.
- [ ] FIX-C1d. dockerArgv never emits a read-write mount whose source contains the core home.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
