# M7-20: One checklist for every hand run still owed

Part of the MetaTrooper desk epic (becoming Ouros), Milestone 7. Priority: High. Effort: not sized. Depends on: none.
Status: open; spread over status ledgers and Known limits.

## Source of truth

- status/M1-STATUS.md (M1-01, M1-10)
- status/M4-STATUS.md (M4-11)
- status/UI-STATUS.md (UI-01, UI-02)
- spec.md Known limits
- issues/m6-05*.md, issues/m6-23*.md

## What is open

- Runs that need his machine, accounts or a second Windows PC: the Codex trust spike; a Gemini hook route on Windows (CLI 0.63 skips the system settings file); one live Claude tool_use_id check; the live capture for the "waiting for your input" idle class (D21); the three M6-23 live runs (subagent Stop, Escape, opencode); M6-00a source install on a second PC; M1-01 dev run under Smart App Control; M1-10 second-user pipe ACL; M4-11 on Windows; UI-01 a workday in the app; UI-02 first agent in 30 s.
- Two Known limits become small bugs once the live capture exists: a spooled hook event can set last_tool from an older call, and the idle class is wrong until captured.

## Blocked on

- He supplies the second Windows PC (D67, D72) and the Codex and Gemini account sessions.

## Acceptance criteria

- [ ] M7-20a. Each run is listed with its exact steps, the machine it needs and the criterion it closes.
- [ ] M7-20b. An item is ticked only with a dated result in its status ledger.
- [ ] M7-20c. The two Known-limit bugs get a failing test then a fix once their capture exists.
- [ ] M7-20d. Their Known limits entries are deleted or reworded when the run lands.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for any fix Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
