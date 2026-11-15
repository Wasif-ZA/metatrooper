---
name: lean-context
description: Keep the context window small so long sessions stay fast and cheap - short shell output through troop route, ranged file reads, no re-reads, results summarised into files instead of pasted. Use in any long session, before running commands with big output (tests, builds, logs, git log, diffs), and when context is filling up.
---

# lean-context

Every line read stays in context and is paid for on every later turn.

## Commands

- Long output (test runs, builds, installs, logs, large diffs): `troop route exec -- <command>`.
  It prints the lines that matter and keeps the full log; `troop route log` reads it back only
  if needed.
- Saved recipes: `troop route search <words>`, then `troop route run <recipe> [args]`.
- Ask git for less: `--stat`, `--oneline`, `-n 20`, `-- <path>`.

## Files

- Search first (`git grep -n`), then read only the lines around the match.
- Never re-read a file you just wrote or edited; the edit tool already confirmed it.
- Never paste a big file or output into a message to the user; give its path and the finding.

## Delegated work

- A subagent or session that researches writes its full findings to a file and returns only a
  short summary plus the path.
- Read that file only if the summary leaves a real question.

## When context is filling

Before it fills: commit, write a resume note (done, decided, the exact next step), and tell the user it is a good point to clear.
