# Skills

Agent skills bundled with MetaTrooper. `troop skills install` copies them into
`~/.claude/skills/`; `troop skills list` shows which are already there.

## MetaTrooper's own (MIT, `skills/LICENSE`)

| Skill | Use it for |
|---|---|
| `troop` | Starting and following agent sessions through the `troop` CLI |
| `second-opinion` | Asking a different engine to check a diff, plan or diagnosis, then comparing |

## Engineering (MIT, `skills/LICENSE`)

| Skill | Use it for |
|---|---|
| `eng-calc` | Hand calculations with units carried through (`pint`), dimension and size checks |
| `lab-report` | Measurement uncertainty, plots with error bars, and the report structure |
| `cad-script` | Parametric parts in build123d or CadQuery, exported and checked by eye |
| `fea-sanity` | Checking FEA and CFD results: hand calc, mesh convergence, boundary conditions |

## Vendored

Copied unchanged. Each folder keeps its upstream licence file.

| Skill | Source | Licence |
|---|---|---|
| `systematic-debugging` | obra/superpowers at bb92a77 | MIT |
| `verification-before-completion` | obra/superpowers at bb92a77 | MIT |
| `brainstorming` | obra/superpowers at bb92a77 | MIT |
| `writing-plans` | obra/superpowers at bb92a77 | MIT |
| `executing-plans` | obra/superpowers at bb92a77 | MIT |
| `test-driven-development` | obra/superpowers at bb92a77 | MIT |
| `requesting-code-review` | obra/superpowers at bb92a77 | MIT |
| `receiving-code-review` | obra/superpowers at bb92a77 | MIT |
| `using-git-worktrees` | obra/superpowers at bb92a77 | MIT |
| `dispatching-parallel-agents` | obra/superpowers at bb92a77 | MIT |
| `skill-creator` | anthropics/skills at dbd4588 | Apache-2.0 |

To refresh a vendored skill, copy its folder again from the upstream commit and update the commit
here and in `THIRD-PARTY-NOTICES.md`.
