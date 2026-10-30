# M8-3: Events back to the agent, and form state

Part of Ouros, Milestone 8. Build step G3. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-2.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 3; `spec.md` Milestone 8 children table row M8-3.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

A click on an agent-drawn button goes back to the session that drew it as its next message, prefixed `[ouros-ui]`. No polling tool.

## Acceptance criteria

- [ ] M8-03a. A click delivers `{surface, event, context}` to the owning session within one turn.
- [ ] M8-03b. Fields carry required, disabled, invalid and error states.
- [ ] M8-03c. A stale or repeated click is dropped.
- [ ] M8-03d. A click after the session ended lands in the needs-you inbox.
- [ ] M8-03e. A question (`choice` the agent waits on) never resolves by time passing; it waits until answered or withdrawn.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
