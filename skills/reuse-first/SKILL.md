---
name: reuse-first
description: Before researching, generating assets, cloning repos or writing new code, search what earlier sessions already produced - notes, research digests, assets, branches, existing helpers - and only do the gap. Use at the start of any research, design or build task, and whenever the user says "we already did this", "look in the earlier work first", or "stop redoing research".
---

# reuse-first

Most repeated work happens because the agent did not look. Looking costs seconds.

## Look in this order

1. **The project itself**: `git grep` for the function, helper or pattern you are about to
   write. An existing helper a few files away beats a new one.
2. **Branches and history**: `git branch -a`, `git log --all --oneline -S '<key string>'` for
   work done and not merged.
3. **Earlier session outputs**: the project's notes, `.troop/` folders, research digests,
   asset folders and any scratch folder the user names. Search by topic words, not file names.
4. **Running sessions**: `troop sessions --json` - another session may be doing it right now.

## Then

- Found it: use it, and say where it came from in one line.
- Found part: list what exists, then do only the gap. Say what the gap is before starting.
- Found nothing: say where you looked, then start.

Never regenerate an asset, rerun research or re-clone a repo that already exists unless the user
asks for a fresh pass or the old one is shown to be wrong.

## Leave it findable

Save new research and assets under a folder named for the subject, with a short README of what
is inside, so the next session's search finds it.
