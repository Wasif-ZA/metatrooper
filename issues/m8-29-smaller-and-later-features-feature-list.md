# M8-29: Smaller and later features (feature list section B)

Part of Ouros, Milestone 8. Priority: Low. Effort: not sized (sized after M8-0). Depends on: M8-15.
Status in scratch: later; keep/change/drop pending.
**Start on or after 2026-11-09.**

## Source of truth

- `spec.md` Milestone 8 row M8-29; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): ~/.cache/claude-scratch/ouros-startpoint-2026-10-30/features/FEATURE-LIST.md section B; kit/specs/f-lessons.json, f-designdiff.json.

## What was designed

- Drawn and held: lessons with proposals (f-lessons, after loops 1 and 2 are measured) and design revision compare (f-designdiff, a plugin capability).
- Not drawn: memory settings (location 24, worktree sharing 19, off switch 6 reactions), run with parameters (157), plain-text notebooks that diff in git (143), anchored comments that survive PDF export (88), edit a past message and fork with code rewound (codex#2948, 85), per-project interpreter (27).
- Plugins, not core: measure in the 3D view, read-only schematic and board viewer, simulation from the design tool.
- Left out for good: unit-aware calculation, real-time collaboration.

## Blocked on

- NEWFEATURES.html keep/change/drop.

## Acceptance criteria

- [ ] M8-29a. f-lessons shows replay results and an "Auto-propose lessons" off switch.
- [ ] M8-29b. Memory settings work without lessons.
- [ ] M8-29c. Each held item stays out of the build until his keep and a measurement say so.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
