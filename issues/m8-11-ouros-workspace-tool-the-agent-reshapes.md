# M8-11: ouros_workspace tool: the agent reshapes the IDE

Part of Ouros, Milestone 8. Build step G11. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-4.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 6c; `spec.md` Milestone 8 children table row M8-11.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

Ask an agent to reshape the IDE and the whole workspace may change. Pinned and never removable: title bar with IDE | WALL, status bar with the inbox entry and Ctrl Alt 0 reset, gates, Undo.

## Blocked on

- STARTPOINT.html call 1 (persona layouts after the scope cut) and the MORPH.html verdict.

## Acceptance criteria

- [ ] M8-11a. Each of the four example requests (workspaces/*.json) produces its layout.
- [ ] M8-11b. Undo restores the layout before the change and My usual restores the default, each in one key.
- [ ] M8-11c. A refused layout leaves the old one and names the reason (the five refusal cases).
- [ ] M8-11d. A waiting gate still shows while the agent panel is hidden.
- [ ] M8-11e. The 8 persona layouts load as examples.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
