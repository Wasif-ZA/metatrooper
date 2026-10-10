# M6-6: Everything comes back after a restart

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical. Effort: 4.0 CC days. Depends on: M6-5.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-6, and every section that names M6-6.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-06a. With 4 live sessions (claude, codex, gemini, a shell), killing the core and the workbench and starting them again brings all 4 back in their tiles, in the same layout, within 30 s, never more than 3 resuming at once.
- [ ] M6-06b. An engine whose resume fails twice with its `auth_error` output stops being resumed and raises one needs-you item. A session that exited shows its saved last screen.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
