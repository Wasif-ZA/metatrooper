---
name: trap-log
description: Record each trap an agent fell into (a command that hangs, a flag that does not exist, a tool that silently truncates, a fix that did not work) in one project file, and read it before starting work so no session repeats it. Use after any failure that cost more than a few minutes, and at the start of a session in a project that has a TRAPS.md.
---

# trap-log

The most expensive work is redoing a mistake another session already paid for.

## Read before starting

If the project has `TRAPS.md`, read it at the start. Search it for the tool or area you are about
to touch before running anything unfamiliar.

## Write after a trap

Append one entry when something cost more than a few minutes and could happen again:

```markdown
- <date> <area>: <what happened, observable>. Cause: <why, if known>. Do instead: <the fix>.
```

Rules:

- One line where possible. The "Do instead" is the useful part; never leave it out.
- Only verified causes. If unsure, write "cause unknown".
- No secrets, personal data or paths outside the project.
- Before adding, search for an existing entry and update it instead of duplicating.
- Remove an entry when the trap is fixed in the code, and say which commit fixed it.

## Tell the user

When a trap is logged, say so in one line so the user can turn it into a real fix.
