---
name: work-retro
description: Build a short retro of a day, week or term from evidence - active time from agent session and commit times, what got done, what slipped, and a few interesting facts. Use for "how long did I work today", "what did I achieve", "quick retro", "how has my week/semester gone", or filling a work or study log.
---

# work-retro

Evidence only. Every claim points to a session, commit or file; nothing is invented.

## 1. Gather

- Agent sessions in the window: `troop sessions --all --json` (without `--all`, hidden sessions
  are left out). It gives each session's current state and `state_at`, not start and end times,
  so take spans from the engine's own transcript files if the user allows it: the first and last
  timestamp in each.
- Commits: `git log --since=<start> --until=<end> --format='%ad %h %s' --date=iso` in each repo.
- Files created or changed in the window, and any calendar or task list the user points to.

## 2. Work out time

Merge overlapping session and commit spans into blocks; a gap over 30 minutes ends a block.
Sum the blocks. Show the working: "09:10-12:40 (3h30) + 14:05-18:20 (4h15) = 7h45".

This is agent activity, not the user's hours: an agent can run while they are away, and they can
work with no agent running. Label it "active time, inferred from sessions and commits". Report
hours worked only from what the user states or a calendar they point to, and keep the two
separate. Parallel agents do not multiply either number.

## 3. Write it

```text
<window>: <active time> across <n> blocks (inferred). Hours worked: <stated, or "not given">.
Done: <3-7 items, each with its evidence>
Slipped: <items started but not finished>
Facts: <2-4 interesting numbers: busiest day, most-touched project, commits, longest block>
Next: <the one thing that would most move things forward>
```

Keep it short; the user reads the first two lines. For a log that a marker or manager will
read, use their template and fill only what the evidence supports, leaving the rest marked for
the user.
