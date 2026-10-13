---
name: second-opinion
description: Ask a different coding agent (Claude, Codex or Gemini) to check a diff, a plan or a diagnosis through MetaTrooper, then compare its answer with yours. Use before a risky or hard-to-reverse change, when stuck after two failed fixes, or when the user asks for a second opinion or a cross-check.
---

# second-opinion

One model reviewing its own work misses the same things twice. Hand the question to a different
engine, let it answer on its own, then put the two answers side by side.

## Steps

1. Check the core is up: `troop ping --json`. If it fails, run `troop start`.
2. Pick an engine that is not you: `troop engines --json` lists the healthy ones.
3. Write the question to a file in the project, for example `.troop/second-opinion/question.md`:
   - what you want checked (the diff range, the plan file, the bug and your diagnosis);
   - what you already believe, in one paragraph, marked as a claim to test, not a fact;
   - where to write the answer, as an absolute path: `<project>/.troop/second-opinion/answer.md`.
4. Launch it on its own worktree so it cannot touch your files. A new worktree does not contain
   untracked files, so give it absolute paths:
   `troop launch codex --project . --worktree second-opinion --prompt "Read <project>/.troop/second-opinion/question.md and answer as it says. Do not edit code." --json`
5. Poll `troop sessions --json` until that `session_id` is `done` or `idle`. If it reaches
   `waiting_for_you`, stop and tell the user; never answer another agent's prompt yourself.
6. Read the answer and report three lists:
   - **Both found**: agree, act on these first.
   - **Only one found**: name which engine. Check each against the code before believing it.
   - **Disagree**: state both positions. Do not quietly pick the one you prefer.

## Rules

- Never send code, data or secrets the user has not cleared to leave the machine. A remote engine
  is an external send.
- A second opinion is advice. Presenting findings is not permission to apply them; ask the user
  which ones to fix.
- Never commit, push or open PRs.
