# M8-20: Adapt to your old IDE: settings, keymap, layout, instructions, run configs

Part of Ouros, Milestone 8. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-17, M8-7.
Status in scratch: approved in principle (FEATURES.md #12); mechanics new here.

## Source of truth

- `spec.md` Milestone 8 row M8-20; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): research/next/FEATURES.md Angle 2, #7, #8, #9, #12; RESUME.md What Ouros is; round-3 Customize Look.

## What was designed

- Reads VS Code and JetBrains settings and keymaps, plus Zed keymap.json and .ideavimrc.
- Layout learning from workbench.sideBar.location, activityBar.location and panel position (verify key names first); asks once "Make this your default?".
- A chord bound in the old IDE but unused in Ouros shows one toast: `Ctrl+Shift+T did "reopen tab" in VS Code. Bind it?`. Needs a table from VS Code command ids to Ouros actions.
- One instructions list: CLAUDE.md, AGENTS.md, .cursor/rules, .kiro/steering (top demand, 6,689 reactions).
- Run configs: tasks.json and launch.json imported, with a list of what was skipped. Sessions imported on first run.
- Rule: detect silently, one summary on first run, detail under Settings > What Ouros learned. No new chrome.

## Blocked on

- M8-0.

## Acceptance criteria

- [ ] M8-20a. First run on a machine with VS Code settings imports theme, keymap and side bar location and lists them in one summary.
- [ ] M8-20b. Unmapped keys are listed as skipped.
- [ ] M8-20c. A chord bound only in the old IDE shows exactly one toast.
- [ ] M8-20d. tasks.json entries appear as agent verbs behind a gate.
- [ ] M8-20e. Every import can be undone from Settings > Learning.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
