# Core service

Child #1 of the Agent Harness epic. Milestone 1. Effort: about 4.5 Claude Code days.

Depends on: nothing.

## What

Core service: `schema.sql` (frozen first), event processor with redaction, state machine, `wt` launcher, session linking, engine registry and health, named-pipe server with run-once commands, queue, port leases, DPAPI secret store, schedules, `usage` ledger, licence files, ACU refusal

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: schema.sql, events-and-hooks.md, pipe-protocol.md.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M1-02. Launching claude, codex and agy for one project opens three Windows Terminal windows named `harness-<id8>`, each a normal interactive session on the existing logins, with no API key set.
- [ ] M1-03. Independence, per engine: start a long turn, kill the workbench and the core. The agent finishes its turn, the user can keep typing, and restarting the core rediscovers the live sessions by pid within 10 s.
- [ ] M1-04. With the core never started, every hook and `launch.ps1` exits 0 with no output, and the engine starts no more than 1 s later than without the harness.
- [ ] M1-05. A test types a marker string into a session and asserts it appears in no harness log or table.
- [ ] M1-06. Speed with 3 live sessions and a running pipeline: window reads p95 under 1 ms; a hook event is on screen within 100 ms; pipe commands p95 under 20 ms.
- [ ] M1-08. Commands sent while the core is down show "queued" within 300 ms and all run, in order, within 2 s of restart. A command that arrives both by pipe and by queue (forced by delaying the reply past 300 ms) runs exactly once. `session.focus` is never queued.
- [ ] M1-08a. Killing the core between `accepted` and `running` re-executes that command on restart; killing it after `running` marks it `error` "interrupted by core restart" with a needs-you item, and it is not re-run.
- [ ] M1-08b. A connection without `ui.hello` gets -32012 from `gate.resolve`, whatever `meta.origin` it claims; a code step's `ctx` has no path to approve.
- [ ] M1-10. A standard local account other than the owner cannot complete a request on either pipe.
- [ ] M1-11. A Claude session shows `waiting_for_you` within 2 s of a permission Notification, `done` within 2 s of Stop, and `idle` after its card is opened (`session.seen`).
- [ ] M1-12. Codex and agy sessions get a `native_id` by the rules in `events-and-hooks.md`, or show "state unknown"; they never show a wrong state on the fixture runs.
- [ ] M1-13. `hooks install` then `hooks uninstall` leaves `~/.claude/settings.json` and `~/.codex/config.toml` byte-identical; the Codex computer-use helper still receives every notify while installed.
- [ ] M1-14. The UserPromptSubmit hook delivers a queued comment as the JSON in `events-and-hooks.md`; killing the hook before it prints leaves the comment for the next prompt (never lost); a normal run prints it once.
- [ ] M1-18b. The same folder opened as `C:\Proj\` and `c:/proj` (on a case-insensitive volume) gets one `project_id`.
- [ ] M1-30. `project.open` on a path containing `work/ACU` returns -32001.
- [ ] M1-32. `core/`, `workbench/`, `tray/` carry AGPL-3.0; `sdk/`, `pipelines/` and the MIT contract files carry MIT.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
