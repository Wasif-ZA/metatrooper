---
name: handoff
description: Write a resume note and a ready-to-paste prompt so a fresh session (after /clear, a crash, or on another device) can pick up exactly where this one stopped. Use when the user says "I'm going to clear", "make a prompt for the next session", "leave a note", "resume after I clear", or when context is nearly full mid-task.
---

# handoff

The next session knows nothing. The note must let it start working in one read, without
redoing research or re-asking decided questions.

## Write RESUME.md

Put it in the task's working folder, not the repo root. Sections, in this order:

1. **Goal**: the user's ask in their own words, one or two lines.
2. **Decided**: every choice the user made, with the date. These are not to be re-asked.
3. **Done**: what exists now, with paths, branches and commit hashes. Say what was verified
   and how.
4. **Where to pick up**: the exact next step, the file it touches, and the command to check it.
5. **Open**: anything unfinished or uncertain, each with what would settle it.
6. **Do not**: approaches already tried and rejected, with the reason, so they are not retried.
7. **Read first**: the few files the next session must read, in order. Nothing else.

Keep research results as pointers to the files that hold them; never paste them in again.

## Write the prompt

Give the user one paragraph to paste after the clear:

```text
Continue <task>. Read <abs path>/RESUME.md in full first, then the files under "Read first".
Start at "Where to pick up". Do not redo research or re-ask anything under "Decided".
```

## Before handing over

- Commit or stash work in progress on a named branch, and name it in RESUME.md.
- Stop every terminal and background job this session started, or list them in RESUME.md.
- Print the prompt last, so it is the first thing the user sees.
