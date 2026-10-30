# M8-21: Gate policy: true gates, decisions and log lines

Part of Ouros, Milestone 8. Priority: Critical. Effort: not sized (sized after M8-0). Depends on: none.
Status in scratch: decided (ouros-spec.md 3; GATES.md section 4); red/amber not adopted.
**Start on or after 2026-11-09.**

## Source of truth

- `spec.md` Milestone 8 row M8-21; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): research/next/GATES.md section 4; kit/SPEC.md 3; round-3/ide3.html?s=inbox; round-4 keep screen.

## What was designed

- True gates, even in auto mode, for a fixed list: A1 discard uncommitted work, A2 recursive or critical delete, A3 force push or push to production / release / gh-pages, A4 secrets leaving, A5 first send to a new host, A6 deploys, money and shared infra, A7 outside the sandbox, A8 a boundary he stated, A9 auto paused after 3 blocks in a row or 20 in total.
- Gates never time out and use the one needs-you colour: Y/N keys, Allow / Show diff / No, a one-line "why it asked".
- Decisions B1-B4 are calm cards that wait forever and count in the inbox badge.
- C1-C8 (edits inside the workspace, reads, installs, test runs, commits, pushes to the working branch) are one grey log line each, with a digest line in the inbox and status bar.
- Re-classification D1-D7 only by proposal: 3 allows with a median answer under 3 s may offer to demote; learned rules are narrow, per project, expire after 30 days unused; the A-list floor is never learned away.
- The inbox has two shelves, Gates and Decisions, plus a read-only Digest. M8-5 ties screen source tags to this system.

## Blocked on

- STATE.html call: may a gate you always allow become a log line, or are all gates fixed?

## Acceptance criteria

- [ ] M8-21a. Each of A1-A9 interrupts in auto mode with the exact action; no timer ever answers.
- [ ] M8-21b. A file edit inside the workspace makes a log line, not a gate.
- [ ] M8-21c. A question never turns orange.
- [ ] M8-21d. No "Allow all N" button exists.
- [ ] M8-21e. A learned allow rule is narrow, expires, and is listed with why it was added.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
