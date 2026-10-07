# Status and notifications: done-unseen, bell and title signal, toast jump, notification inbox, Clear status, Resume dead sessions

Child status-and-notifications of the UI revision epic (issues/archive/ui-revision-epic.md). M1 revision. Effort: about 1.5 Claude Code days.

Depends on: terminal-core, layout-shell.

## Source of truth

- issues/archive/ui-revision-epic.md, sections: Selection, inbox, status; Resume.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] UI-06: killing the core marks live sessions exited; claude and codex show Resume with resume_args; agy shows Start new here.
- [ ] Done, unseen, toast click, inbox mark-read and mark-unread, Clear status as in Contracts.

## Rules that bind every child

- Never push or open PRs from an agent; hand back the command.
- Codex writes the tests for terminal-core.
- No em dashes; comments say what the code does, not why.
