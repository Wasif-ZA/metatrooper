# M6-21: Changed files per tile

Part of the MetaTrooper desk epic, Milestone 6. Priority: Medium. Effort: 1.0 CC days. Depends on: none.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-21, and every section that names M6-21.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [x] M6-21a. A session that edits 3 files shows "3 changed"; committing one shows "2 changed". (2026-11-24, B4 on a8a3b642 (own npm ci): workbench/test/m6-21-changed-files.test.ts 4/4)

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.

Status 2026-11-24: done, every box ticked; each box names its test. Run by B4 on a8a3b642 with its own npm ci; full suite green on eca8743a (M).
