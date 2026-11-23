# M6-9: Wall keys and attention

Part of the MetaTrooper desk epic, Milestone 6. Priority: High. Effort: 2.0 CC days. Depends on: M6-1, M6-5.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-9, and every section that names M6-9.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [x] M6-09a. Alt+J focuses the session with the smallest `since`. A key press in the big tile, then a second session starts waiting: the big slot stays unchanged for 3 s, then the waiting tile glides in. (2026-11-24, B4 on a8a3b642 (own npm ci): workbench/test/m6-09-wall-keys.test.ts 4/4)

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.

Status 2026-11-24: done, every box ticked; each box names its test. Run by B4 on a8a3b642 with its own npm ci; full suite green on eca8743a (M).
