# M8-0: Pick the host: VSCodium webview or Ouros's own renderer

Part of Ouros, Milestone 8. Build step G0. Priority: Critical. Effort: not sized (sized after M8-0). Depends on: none.

## Source of truth

- `ouros-spec.md` section 9; `spec.md` Milestone 8 children table row M8-0.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

The kit is plain HTML and CSS, so it can run in a VSCodium webview or in a renderer Ouros owns. Every later step wires tabs, events and zones into whichever host wins, so this comes first. It is Wasif's call.

## Blocked on

- Wasif's call on the host itself.

## Acceptance criteria

Decided 2026-11-14 in `spec.md` D84: agent-drawn screens are @astryxdesign/core parts drawn as tabs inside cc (Electron).

- [ ] M8-00a. The choice is written in spec.md D-list with the reason and the drawback of the option not taken.
  Status: PARTIAL. D84 records the choice and the reason. It does not name the drawback of the VSCodium webview.
  Verify: `Select-String spec.md -Pattern '^\| D84 \|'` shows the row, and the row names the drawback of the option not taken.
- [ ] M8-00b. The chosen host passes the dependency gate (licence, stars, maintenance) with the numbers recorded, or is exempt because it is Ouros's own code.
  Status: PARTIAL. cc is Ouros's own code, so it is exempt. D84 records recharts' numbers (MIT, 27,709 stars) but not @astryxdesign/core's.
  Verify: `Select-String spec.md -Pattern 'astryx'` shows a D-row with astryx's licence, stars and last push.
- [ ] M8-00c. A one-page note names how tabs open, how events reach the core, and how the title-bar IDE | WALL switch is drawn in that host.
  Status: PARTIAL. D84 names how a tab opens (`ouros_ui` to `ui.show`, then `ui.get` on a seq change). The `ui.event` row in `contracts/pipe-protocol.md` names how a click reaches core. Nothing names the IDE | WALL switch.
  Verify: `Select-String spec.md,contracts/pipe-protocol.md -Pattern 'ui\.show|ui\.event|IDE \| WALL'` finds all three in one note.
- [ ] M8-00d. An agent's `ouros_ui` call opens its screen as a tab over the editor area in cc. (was: a spike opens specs/f-done.json as a tab)
  Status: PARTIAL. Built (`workbench/ui/src/kit/DrawnTabs.jsx`, `syncDrawn`), but no test opens the tab. Same gap as M8-02a.
  Verify: to write, `workbench/test/m8-02-drawn-tabs.test.ts` test "a new surface in the snapshot opens one tab and a seq bump redraws it".

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
