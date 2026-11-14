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

As built 2026-11-15: plugins from M1 (`plugin.preview`, `plugin.install` with a manifest hash and approved permissions; actions run with a stripped environment). There is no OS sandbox, artifact hash, remote block or tool access table.

- [ ] M8-14a. An undeclared file or network access from a cli plugin is refused by the OS sandbox.
  Status: NOT STARTED. Actions get a stripped environment, not an OS sandbox.
  Verify: to write, `core/test/m8-14-sandbox.test.ts` test "a cli plugin reading an undeclared file is refused by the sandbox".
- [ ] M8-14b. A changed artifact hash asks you, with a version diff and the scan result.
  Status: PARTIAL. A manifest that changed since preview installs nothing. There is no artifact hash, version diff or scan.
  Verify (passes now): `cd core; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="install refuses approvals" test/plugins.test.ts` and `... --test-name-pattern="wire-08" test/wiring-security.test.ts`.
  Verify (to write): `core/test/m8-14-hash.test.ts` test "a changed artifact hash asks with a version diff and the scan result".
- [ ] M8-14c. A remote block disables a plugin and says why.
  Status: NOT STARTED.
  Verify: to write, `core/test/m8-14-block.test.ts` test "a plugin on the remote block list is disabled with its reason".
- [ ] M8-14d. Ouros runs a plugin's approved binary by hash, never by a PATH lookup. cc's own tool calls keep the PATH lookup (M1-25a; `spec.md` D85). (was: Ouros runs the approved binary by hash, never by a PATH lookup)
  Status: NOT STARTED.
  Verify: to write, `core/test/m8-14-hash.test.ts` test "an action whose binary hash differs from the approved one does not run".
- [ ] M8-14e. Plugin grants, updates and revocation (`f-plugin`): the install sheet shows enforced grants and the text a plugin adds.
  Status: PARTIAL. Install refuses approvals that do not match the permissions asked for; `plugin.preview` returns the sheet. Updates and revocation are not built.
  Verify (passes now): `cd core; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="install refuses approvals" test/plugins.test.ts`.
  Verify (to write): `core/test/m8-14-grants.test.ts` test "revoking a grant stops the next action that needs it".
- [ ] M8-14f. Remembered, scoped tool access (a table in Settings > Safety): allow, ask or deny per tool, per project, with a separate subagent column; the stop list still asks every time.
  Status: NOT STARTED.
  Verify: to write, `core/test/m8-14-tool-access.test.ts` test "a deny for one tool in one project holds, and a stop-list tool still asks".

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
