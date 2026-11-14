# M8-2: ouros_ui MCP tool and the tab zone

Part of Ouros, Milestone 8. Build step G2. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-1.

## Source of truth

- `ouros-spec.md` section 2, 3, 4; `spec.md` Milestone 8 children table row M8-2.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

The first transport. An agent calls `ouros_ui(surface, zone, spec)`; Ouros validates each part, applies the profile and draws the surface in an editor tab.

## Acceptance criteria

As built (D84): the MCP server `ouros-ui` (`core/src/hook/mcp-shim.ts`) offers `ouros_ui`, which calls core `ui.show` (`core/src/surfaces.ts`). Core stores the surface in `ui_surface` and lists it in the snapshot. The workbench fetches it with `ui.get` and opens a tab (`DrawnTabs.jsx`).

- [ ] M8-02a. Claude Code calls `ouros_ui` and a tab opens with the screen.
  Status: PARTIAL. The attach flags and the store are tested. No test opens the tab from the snapshot.
  Verify (passes now): `cd core; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="method layer stores" test/m8-02-ui-surface.test.ts` and `... --test-name-pattern="M5-12f STDIO external writer" test/m5-remote-mcp.test.ts`.
  Verify (to write): `workbench/test/m8-02-drawn-tabs.test.ts` test "a new surface in the snapshot opens one tab and a seq bump redraws it".
- [x] M8-02b. A bad part draws as a plain-text box saying why; its siblings still draw; the result lists it in `fellBack`.
  Status: DONE.
  Verify: `cd core; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="ui.show reports and stores" test/m8-02-ui-surface.test.ts` (6 tests, case "mixed"), and `cd workbench; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="preserves a good sibling" test/m8-01-kit-draw.test.ts test/m8-01-kit-parts.test.ts` (63 tests).
- [x] M8-02c. A call naming another session's surface is rejected.
  Status: DONE.
  Verify: `cd core; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="another session cannot replace" test/m8-02-ui-surface.test.ts` (1 test).
- [x] M8-02d. A part from a newer catalogue version draws as text naming the part, never a crash.
  Status: DONE.
  Verify: `cd core; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="ui.show reports and stores" test/m8-02-ui-surface.test.ts` (case "unknown root", catalogue "999", fellBack names `newer-part`).

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
