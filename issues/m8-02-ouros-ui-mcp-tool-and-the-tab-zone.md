# M8-2: ouros_ui MCP tool and the tab zone

Part of Ouros, Milestone 8. Build step G2. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-1.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 2, 3, 4; `spec.md` Milestone 8 children table row M8-2.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

The first transport. An agent calls `ouros_ui(surface, zone, spec)`; Ouros validates each part, applies the profile and draws the surface in an editor tab.

## Acceptance criteria

- [ ] M8-02a. Claude Code calls `ouros_ui` and a tab opens with the screen.
- [ ] M8-02b. A bad part draws as a plain-text box saying why; its siblings still draw; the result lists it in `fellBack`.
- [ ] M8-02c. A call naming another session's surface is rejected.
- [ ] M8-02d. A part from a newer catalogue version draws as text naming the part, never a crash.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
