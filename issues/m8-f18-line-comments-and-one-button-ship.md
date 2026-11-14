# M8-F18: Comment on a changed line, and one button to commit, push and open a PR

Part of Ouros, Milestone 8, feature 18. Rides on: M8-18, M8-28. Screen: `proto/kit/workspaces/n05-diff-comment.json`, shot `proto/shots/n05-diff-comment.png`.
Effort: not sized until M8-0.

Grouped: the two rows share one screen and one review flow.

## Source of truth

- `spec.md` Milestone 8, "Direction, 2026-11-05".
- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/` (also `ouros/direction` in the wip repo): `board.py` rows "Comment on a changed line" and "One button"; `research-ide/F/PAINS.md` A1.

## What it does

A comment on a changed line becomes the agent's next message.
One button commits, pushes and opens a PR.
The screen also shows tests, types and any review result beside the button.
Non-developers get Publish instead (M8-F15).

This reverses one line in M8-18, which said "no line comments". He approved this screen on 2026-11-05.
The workbench already saves `diff-line` comments (`workbench/src/main.ts`, `saveComment`). So this moves them into the Ouros Review tab.

## Evidence

- Diff review asks are still open: claude-code #33932 at 221 thumbs-up, codex #2998 at 241 (PAINS.md A1).
- Board references: Orca for notes on lines, T3 for commit and push. Rivals have this, so it is expected.

## Blocked on

- Nothing of his on the comment.
- GitHub login stays his own account setup. Ouros uses what is already logged in.

## What gets built

Not sized until M8-0.

| # | Change | Reuses |
|---|---|---|
| 1 | Comment box on a diff line | `saveComment`, `comment.deliver`; part `linediff` |
| 2 | Button that runs commit, push, PR in order and stops on the first failure | Part `shipbar`; M8-28 git and hand-back screen; M8-25 branch |
| 3 | Commit message and PR body drafted by the agent, editable first | M8-F1 result on the screen |

## Acceptance criteria

- [ ] M8-F18a. A comment reaches the agent with its file and line, in its next message.
- [ ] M8-F18b. The agent can draft the message but cannot press the button. Only a person's press commits, pushes or opens a PR.
- [ ] M8-F18c. A failed step stops the rest and names the step.
- [ ] M8-F18d. The button never force-pushes and never pushes to the default branch.
- [ ] M8-F18e. The result beside the button shows what the checks did, including what was not checked (M8-F1).
- [ ] M8-F18f. The shipped screen matches `n05-diff-comment.json` and passes validate.mjs.

## Rules that bind every child

- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
