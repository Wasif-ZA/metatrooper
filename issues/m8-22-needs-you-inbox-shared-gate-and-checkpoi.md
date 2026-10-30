# M8-22: Needs-you inbox, shared gate and checkpoint rewind

Part of Ouros, Milestone 8. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-21, M8-17.
Status in scratch: approved (F1-F3, G1-G3).
**Start on or after 2026-11-09.**

## Source of truth

- `spec.md` Milestone 8 row M8-22; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): round-3/ide3.html?s=inbox|review|rewind; two-engine/reconcile.md G1-G3; polish/D.md.

## What was designed

- Inbox plus toast (claude-code #57230, #29438). One shared gate across IDE and wall with an age timer: solid orange after 2 minutes, one OS toast. No "Allow all N".
- Gate detail lists files with +/- and Allow / Show diff / No, Y/N keys. Trust rules and Tab-to-type are deferred.
- A new rule shows a one-line reason plus Undo.
- Checkpoint rewind (F3) with Ctrl Z and a pointer to the checkpoint in the log; M8-F2 draws the preview.
- The inbox lists agent, request and age; the status bar shows the first waiting request.

## Blocked on

- M8-21's gate-demotion call.

## Acceptance criteria

- [ ] M8-22a. A gate raised on the wall shows the same in the IDE inbox, and answering one clears the other.
- [ ] M8-22b. After 2 minutes the gate turns solid orange and exactly one OS toast was sent.
- [ ] M8-22c. Rewind restores files to the checkpoint.
- [ ] M8-22d. The inbox opens from the status bar on every layout.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
