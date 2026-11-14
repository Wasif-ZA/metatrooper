# M8-14: Plugins: manifest, OS sandbox, Explore screen, index

Part of Ouros, Milestone 8. Build step G14. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-13.

## Source of truth

- `ouros-spec.md` section 6e plugins; `spec.md` Milestone 8 children table row M8-14.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

Installed means off. cli and mcp plugins run in an OS sandbox from their declared capabilities; wasm plugins in a WebAssembly host. Every new artifact hash is an update you approve.

Feature screens folded in (kit/specs): `f-plugin.json` (install dialog). Tool access has no screen: it is a table in Settings > Safety.

2026-11-05: new list and detail screen `~/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/workspaces/n08-plugins.json`. This also owns the board rows "Skills and MCP connections" and, with M8-12, "Website builder, video cutter, spreadsheet, part designer and others".

## Blocked on

- STARTPOINT.html call 3 (plugin confinement) and keep/change/drop on f-plugin, f-toolaccess.

## Acceptance criteria

- [ ] M8-14a. An undeclared file or network access from a cli plugin is refused by the OS sandbox.
- [ ] M8-14b. A changed artifact hash asks you, with a version diff and the scan result.
- [ ] M8-14c. A remote block disables a plugin and says why.
- [ ] M8-14d. Ouros runs the approved binary by hash, never by a PATH lookup.
- [ ] M8-14e. Plugin grants, updates and revocation (`f-plugin`): the install sheet shows enforced grants and the text a plugin adds.
- [ ] M8-14f. Remembered, scoped tool access (a table in Settings > Safety): allow, ask or deny per tool, per project, with a separate subagent column; the stop list still asks every time.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
