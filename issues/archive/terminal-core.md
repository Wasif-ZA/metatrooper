# Terminal module, terminal pipe, launch rewrite, schema migration, clean cut of wt and herdr, docs

Child terminal-core of the UI revision epic (issues/archive/ui-revision-epic.md). M1 revision. Effort: about 5 Claude Code days.

Depends on: none.

## Source of truth

- issues/archive/ui-revision-epic.md, sections: Implementation details, Contracts: Terminal pipe, Prompt typed into the terminal, Bell and title, Selection.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] Task 0: node-pty loads under core Node and drives ConPTY (spawn, echo, resize, exit).
- [ ] UI-03 core half: a session keeps running and its snapshot matches after every viewer detaches.
- [ ] UI-05: the grep for wt.exe, TROOP_LAUNCHER and herdr in core/src, workbench/src, workbench/renderer returns nothing.
- [ ] UI-07: a fake engine with no prompt_arg gets the prompt once; core.prompt-written once; Paste prompt returns already written; no handoff gate row.
- [ ] UI-10 attach half: 10,000 rows of scrollback attach in under 500 ms.
- [ ] UI-11: all core and workbench tests pass on the terminal module; none spawns wt.exe.

## Rules that bind every child

- Never push or open PRs from an agent; hand back the command.
- Codex writes the tests for terminal-core.
- No em dashes; comments say what the code does, not why.
