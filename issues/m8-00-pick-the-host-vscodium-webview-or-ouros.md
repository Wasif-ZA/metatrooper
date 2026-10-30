# M8-0: Pick the host: VSCodium webview or Ouros's own renderer

Part of Ouros, Milestone 8. Build step G0. Priority: Critical. Effort: not sized (sized after M8-0). Depends on: none.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 9; `spec.md` Milestone 8 children table row M8-0.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

The kit is plain HTML and CSS, so it can run in a VSCodium webview or in a renderer Ouros owns. Every later step wires tabs, events and zones into whichever host wins, so this comes first. It is Wasif's call.

## Blocked on

- Wasif's call on the host itself.

## Acceptance criteria

- [ ] M8-00a. The choice is written in spec.md D-list with the reason and the drawback of the option not taken.
- [ ] M8-00b. The chosen host passes the dependency gate (licence, stars, maintenance) with the numbers recorded, or is exempt because it is Ouros's own code.
- [ ] M8-00c. A one-page note names how tabs open, how events reach the core, and how the title-bar IDE | WALL switch is drawn in that host.
- [ ] M8-00d. A spike opens one kit screen (specs/f-done.json) as a tab in the chosen host.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
