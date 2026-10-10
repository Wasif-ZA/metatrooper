# M6-22: Input watcher: injected input and UI Automation changes from other programs

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical. Effort: 4.5 CC days. Depends on: M6-14.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-22, and every section that names M6-22.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-22a. With a grant live, a fixture PowerShell `SendKeys` run from an agent's terminal raises one "input from another program" needs-you item within 1 s and sets the pause flag; a `metatrooper-desktop` `type` in the same window raises none.
- [ ] M6-22b. With the helper blocked (fixture policy), every granted tile shows "input watcher off".
- [ ] M6-22c. With a grant live and no physical input for 5 s, a fixture script that clicks a button in another app through UI Automation `InvokePattern` raises one "the desktop changed while you were away from it" item within 1 s; the same script while the tester is typing raises none.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
