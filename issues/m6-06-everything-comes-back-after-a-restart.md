# M6-6: Everything comes back after a restart

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical. Effort: 4.0 CC days. Depends on: M6-5.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-6, and every section that names M6-6.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [x] M6-06a. With 4 live sessions (claude, codex, gemini, a shell), killing the core and the workbench and starting them again brings all 4 back in their tiles, in the same layout, within 30 s, never more than 3 resuming at once.
  Passed 2026-11-17 on launch/cc-1117 f57c4c89, full core suite run 1: core/test/m6-06-restart.test.ts, all four
  M6-06a tests ("killing the core brings 4 live sessions back within 30 s, never more than 3 starting in any 10 s",
  "a second core restart while resumes are still queued resumes the rest", and the two pacing tests). The test kills
  and restarts the core only; the workbench re-layout half is not covered by an automated test.
- [x] M6-06b. An engine whose resume fails twice with its `auth_error` output stops being resumed and raises one needs-you item. A session that exited shows its saved last screen. (2026-11-24, B4 on a8a3b642: core/test/m6-06-restart.test.ts 10/10, the four M6-06b tests)

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
