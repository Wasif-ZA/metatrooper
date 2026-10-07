# Pipeline runner

Child #4 of the MetaTrooper epic. Milestone 1. Effort: about 4.5 Claude Code days.

Depends on: child #1, child #3.

## What

Pipeline runner: validation with the publish rule, handoff contract, completion signals, gates with `action_hash`, fan-out, worktrees, port allocation, loops, resume, breaker, budgets, code steps, `repo` plugin

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: pipeline.schema.json, pipelines.md.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M1-18. A pipeline with a publish step and no earlier approve gate fails validation from the file and the form view; so does a publish or external step with `fanout`, and an agent publish step without a pinned `engine`.
- [ ] M1-18a. A `kind: "pipeline"` step runs its child with the parent's remaining budget, shows the child's gates in the parent, and returns the child's last-step outputs; nesting a pipeline inside itself fails validation.
- [ ] M1-19. Changing a publish step's arguments after approval marks the gate `stale` and pauses for a new approval; a `code` step and a non-TTY CLI cannot resolve a gate.
- [ ] M1-20. A loop that never passes stops at `max`; a step failing 3 times trips the breaker; resume restarts from the failed step with earlier outputs kept.
- [ ] M1-21. A run over `max_tokens` starts no new step; its overshoot is at most the usage of the steps running at that moment, and never more than `max_parallel` of them.
- [ ] M1-22. Fan-out 3 on the fixture repo gives 3 worktrees, 3 leased ports starting at 3001 (skipping a port the test occupies), and 3 browser panes; each pane is drivable only by the session found through its own process ancestry, including for Codex sessions.
- [ ] M1-25c. A `dev_command` variant is shown in its pane only after its port answers; discarding the variant leaves no process from its tree running and releases the port lease.

Status 2026-09-29: built, not yet tested by Codex. Boxes stay unticked until Codex's suite passes. A throwaway
smoke run on Linux (fake engine, `TROOP_LAUNCHER=spawn`) passed M1-18, M1-18a, M1-19 (stale gate, non-UI
refusal, code step has no gate method), M1-20, M1-21, the worktree, port and pane parts of M1-22, and
M1-25c. Pane ownership by process ancestry in M1-22 is child #6. Choices the contracts left open are in
`contracts/pipelines.md`, "Runner details".

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
