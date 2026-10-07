# Electron workbench

Child #5 of the MetaTrooper epic. Milestone 1. Effort: about 3 Claude Code days.

Depends on: child #1, child #4.

## What

Electron workbench: project picker, session cards and focus, engine lights, runner view, form editor, gate panel, needs-you queue, "core offline" badge, database watcher

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: pipe-protocol.md, schema.sql.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M1-01. `npm run dev` opens the workbench on laptop-ops with Smart App Control on.
- [ ] M1-07. Over a 10-minute scripted session, including two core kills and restarts, the workbench renderer has no main-thread task over 50 ms (long-task observer).
- [x] M1-11. A Claude session shows `waiting_for_you` within 2 s of a permission Notification, `done` within 2 s of Stop, and `idle` after its card is opened (`session.seen`).

Status 2026-09-29: built. On Linux under Xvfb with Electron 44.4.5: M1-11 passes in `workbench/test/electron.test.ts`
(waiting_for_you and done shown within 2 s of the hook, idle after `session.seen`, offline badge within 8 s of
killing the core); a 1.5-minute run of `workbench/scripts/longtask-session.ts` with two core kills logged no
long task. M1-01 (Smart App Control on laptop-ops) and the full 10-minute M1-07 run are still to do on Windows,
so their boxes stay open.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
