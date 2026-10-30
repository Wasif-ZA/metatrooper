# M8-33: Explorer pane in Ouros with "changed by agents"

Part of Ouros, Milestone 8. Priority: Medium. Effort: not sized (sized after M8-0). Depends on: M8-17, M8-30.
Status in scratch: verdict pending.
**Start on or after 2026-11-09.**

## Source of truth

- `spec.md` Milestone 8 row M8-33; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): ~/.cache/claude-scratch/ouros-explorer-2026-10-30/round-2/FIXES.md F5, F10, F12, F13; round-1/board.json; issues/m7-09-files-panel.md.

## What was designed

- The IDE host of Della's renderer. Inside Ouros it supersedes M7-9's Files panel and reuses its guard and write rules.
- A Changed group on top (live every 2 s, M/A/D, who changed it), then the tree. Folders show one 6px dot per working agent.
- Names recoloured by git state (modified #e2c08d, added #81b88b) with one right-aligned letter; hover shows a one-line summary card.
- Find uses `?` for meaning and shows icon, name, path and one code line per hit. "Changed by agents" groups by agent and run and flags files two agents touched.
- The pane says Explorer, never Della.

## Blocked on

- Della calls C5 (name) and C6 (hover card over the editor or inline); M8-0.

## Acceptance criteria

- [ ] M8-33a. An edit made outside Ouros shows in Changed within 2 s.
- [ ] M8-33b. A file two agents touched is flagged.
- [ ] M8-33c. Each row uses one status system only.
- [ ] M8-33d. The undo toast reads "Restored 2 files, 1 skipped" style counts; the word Della never appears.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
