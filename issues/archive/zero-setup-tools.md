# Zero-setup tools: MCP, toolrouter, hooks, skills at launch; one-click actions; shell tabs; drag onto terminal

Child zero-setup-tools of the UI revision epic (issues/archive/ui-revision-epic.md). M1 revision. Effort: about 2 Claude Code days.

Depends on: terminal-core, layout-shell.

## Source of truth

- issues/archive/ui-revision-epic.md, sections: Zero setup, actions, shells, drag.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] Engine settings applied at first launch with no separate step.
- [ ] Plugin actions listed in the Ctrl+K palette.
- [ ] PowerShell and Git Bash shell tabs.
- [ ] Drag a file onto a terminal sends its text as input without Enter.

## Rules that bind every child

- Never push or open PRs from an agent; hand back the command.
- Codex writes the tests for terminal-core.
- No em dashes; comments say what the code does, not why.
