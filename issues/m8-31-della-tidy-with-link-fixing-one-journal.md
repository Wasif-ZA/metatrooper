# M8-31: Della: tidy with link fixing, one journal, honest undo

Part of Ouros, Milestone 8. Priority: Medium. Effort: not sized (sized after M8-0). Depends on: M8-30.
Status in scratch: verdict pending.
**Start on or after 2026-11-09.**

## Source of truth

- `spec.md` Milestone 8 row M8-31; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): ~/.cache/claude-scratch/ouros-explorer-2026-10-30/round-2/FIXES.md F8-F10, round-1/board.json; della-idea-mine-2026-10-30 organise lane.

## What was designed

- Tidy proposes moves grouped by destination and reason (his rule or a guess): "Downloads -> Documents/Invoices/2026", "Updates 1 link in kickoff-notes.md", with Show change for before and after.
- Low-confidence moves and zips arrive unticked and amber (#d8b477). Preview returns a plan id (cached 30 minutes, at most 32); Apply runs only ticked rows.
- Moves never overwrite: hard-link then delete, or exclusive copy plus SHA-256 across drives. Every move and link edit is journalled with the file hash.
- Undo skips a row whose file changed or whose old path is taken, and says Skipped, not Undone.
- Link fixing covers markdown links and wikilinks; TS imports only if call C4 says so.

## Blocked on

- Della call C4 (link-fix scope).

## Acceptance criteria

- [ ] M8-31a. Unticked rows are untouched after Apply.
- [ ] M8-31b. A `[[x]]` link is rewritten only if the new target exists; Apply is all or nothing.
- [ ] M8-31c. After an edit to a moved file, Undo skips that row with a reason and restores the rest.
- [ ] M8-31d. A file already at the destination aborts that move without overwriting.
- [ ] M8-31e. The suggestion count matches the rows shown.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
