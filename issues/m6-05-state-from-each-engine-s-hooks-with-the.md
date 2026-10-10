# M6-5: State from each engine's hooks, with the Codex trust spike

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical. Effort: 3.5 CC days. Depends on: M6-4.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-5, and every section that names M6-5.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-05a. A Codex session shows `waiting_for_you` within 2 s of a PermissionRequest and `done` within 2 s of Stop on the M1-12 fixtures, and never shows `done` while an approval prompt is on screen. Fallback branch, used only if the spike's result file says neither trust path works: `waiting_for_you` within 2 s of the approval prompt's title or bell, and the gap is in Known limits.
- [ ] M6-05b. A Gemini CLI session gets a `native_id` and shows `waiting_for_you` and `done` from its hooks; `~/.gemini/settings.json` is byte-identical afterwards and the per-session file is gone.
- [ ] M6-05c. A Claude session in a permission wait stays `waiting_for_you` through a PreToolUse for a different `tool_use_id`, and moves to `working` on the PostToolUse of the waited call.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
