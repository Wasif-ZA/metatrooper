# M8-17: Core IDE shell: Void layout, IDE | WALL switch, status bar

Part of Ouros, Milestone 8. Priority: Critical. Effort: not sized (sized after M8-0). Depends on: M8-0.
Status in scratch: approved (round 1 D1, round 2 all components).
**Start on or after 2026-11-09.**

## Source of truth

- `spec.md` Milestone 8 row M8-17; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): RESUME.md Decided; round-1/ide.html; round-2/ide2.html; round-3/ide3.html?s=default|wall; two-engine/reconcile.md C1-C4, W1-W3, P1-P3; polish/A.md; research/next/BASELINE.md.

## What was designed

- VS Code's layout in the Vesper near-black palette (D1 Void); D2 to D5 ship as themes only.
- Title-bar search shows `project : branch` and shrinks like VS Code. The IDE | WALL switch has static state dots, a hover list and Ctrl+Alt+W; no pulse, no per-dot click.
- Activity bar badge is a number only. Status bar reads "1 needs you · 2 working" plus a one-time "Feels like" toast.
- Wall tiles: footer shows age or idle only, never context % or cost; done tiles collapse after 10 minutes.
- Agent panel: the NEEDS YOU stamp sits on the waiting tab only, other tabs get dots; tool blocks fold at 5 or more commands, failing ones stay open; the agent picker offers a worktree and no pinning.
- BASELINE.md's 56 editor rows are the acceptance checklist for the shell; 36 are not shown in the renders (multi-cursor, find and replace, folding, split editors, format on save, snippets, auto save, markdown preview, language intelligence, project search, debugger, git panel). M8-0's host decides how many come free.

## Blocked on

- M8-0 host pick; STATE.html polish defaults (solid meters, rose #ec6a78 for fail); extensions in v1 and Remote/WSL in v1 (PAINS.md not-addressed #10, #20).

## Acceptance criteria

- [ ] M8-17a. IDE to WALL and back, by the toggle and by Ctrl+Alt+W, keeps tabs, scroll and terminal state.
- [ ] M8-17b. No workspace change can remove the title bar or the status bar.
- [ ] M8-17c. The status bar count matches the inbox on every layout.
- [ ] M8-17d. A tile footer never shows cost or context %.
- [ ] M8-17e. Done tiles collapse at 10 minutes and expand again on click.
- [ ] M8-17f. Every BASELINE.md row is marked works, comes from the host, or out, with a reason.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
