# M8-32: Della standalone window: browse, find, start panel, rendered preview

Part of Ouros, Milestone 8. Priority: Low. Effort: not sized (sized after M8-0). Depends on: M8-30.
Status in scratch: round 2 drawn, verdict pending (round 1 judged bad by both engines).

## Source of truth

- `spec.md` Milestone 8 row M8-32; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): ~/.cache/claude-scratch/ouros-explorer-2026-10-30/round-2/della.js, della.css, FIXES.md F1-F7, F14, N1-N4, judge/RECONCILE.md; research/EXPLORER.md; BOARD.html.

## What was designed

- 1280x800 window: Places sidebar, list (Name, About, Modified, Size, 28px rows), inspector with a real rendered page at 210x280.
- 28px image thumbnails, 20px Fluent SVG icons; selection is a #2a2a2a fill plus a 2px #6ea8fe bar.
- Variants: N1 thumbnail grid (about 168x150), N2 Miller columns, N3 Ctrl+K empty box (640px: recent files, frequent folders, 3 example prompts), N4 two-line 40px rows.
- First-run indexing is one block with a 4px bar: "Search by name works now; search by meaning is indexing." No glows, washes or glass.

## Blocked on

- Della calls C1 (default view), C2 (row height), and yes/no on F1-F14 and N1-N4.

## Acceptance criteria

- [ ] M8-32a. The first screen is never blank.
- [ ] M8-32b. A photo folder opens as a grid, a document folder as a list.
- [ ] M8-32c. The inspector matches the selected row.
- [ ] M8-32d. Secondary text is #9a9a9a or lighter on #121212, 12px minimum.
- [ ] M8-32e. Each of the 6 screens passes the page check with no glow, wash or blur.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
