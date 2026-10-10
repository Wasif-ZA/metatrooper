# M6-1: Split the pipelines out

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical. Effort: 3.5 CC days. Depends on: none.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-1, and every section that names M6-1.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-01a. After the split, every row of `issues/m6-01-split-inventory.md` is closed, and re-running its `rg` command returns only rows marked keep; `npm run build` and both default suites pass; `troop run start` prints "moved to metatrooper-pipelines" and exits 2; `core.ping` still answers.
- [ ] M6-01b. `projects/metatrooper-pipelines` exists and `git log --oneline -- core/src/pipelines/runner.ts` there shows the commits from before the split; the tag `pipelines-final` exists on MetaTrooper's origin.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
