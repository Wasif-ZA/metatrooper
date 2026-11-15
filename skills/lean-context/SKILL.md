---
name: lean-context
description: Keep the context window small so long sessions stay fast and cheap - short shell output through troop route, ranged file reads, no re-reads, results summarised into files instead of pasted. Use in any long session, before running commands with big output (tests, builds, logs, git log, diffs), and when context is filling up.
---

# lean-context

Every line read stays in context and is paid for on every later turn.

## Commands

- Long output (test runs, builds, installs, logs, large diffs): `troop route exec -- <command>`.
  It prints the lines that matter and keeps the full log; `troop route log` reads it back only
  if needed. When a check decides whether work is done, read its full result
  (`verification-before-completion`), not the summary alone.
- Saved recipes: `troop route search <words>`, then `troop route run <recipe> [args]`.
- Ask git for less: `--stat`, `--oneline`, `-n 20`, `-- <path>`.

## Files

- Search first (`git grep -n`), then read only the lines around the match.
- Do not re-read a file only to confirm your own edit; the edit tool already did. Re-read it when
  something else may have changed it or you need lines you have not seen.
- Never paste a big file or output into a message to the user; give its path and the finding.

## Delegated work

- A subagent or session that researches writes its full findings to a file and returns only a
  short summary plus the path.
- Read that file only if the summary leaves a real question.

## When context is filling

Before it fills: write a resume note (done, decided, the exact next step, uncommitted files) and
tell the user it is a good point to clear. Do not commit; leave the changes where they are.
