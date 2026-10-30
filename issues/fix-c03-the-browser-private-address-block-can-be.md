# FIX-C3: The browser private-address block can be lifted from the project's own config

From the 2026-10-31 audit of core. Severity: Medium. Effort: S unless the fix says otherwise.

## Where

- workbench/src/browser/panes.ts:217-227; core/src/browser/policy.ts:88

## What goes wrong

checkUrl allows any host in allowHosts before the address checks, and allowHosts is read from `<project>/.troop/config.json`, a file the agent can write. Adding 169.254.169.254, 10.x or 127.0.0.1 there lifts the private-range block. The same file is already ignored for allow_origins for this reason (approvals.ts:239, D5). Verified in panes.ts on 2026-10-31.

## Fix

Move allow_hosts to settings.json (written only through ui.hello) and ignore the project file.

## Audit

Read-only audit of core/src, 2026-10-31. Tests at audit time: `node --test "test/*.test.ts"` in core, 726 tests, 715 pass, 0 fail, 11 skipped.

## Acceptance criteria

- [ ] FIX-C3a. A pane with allow_hosts 127.0.0.1 only in .troop/config.json still blocks http://127.0.0.1:<unowned port>.
- [ ] FIX-C3b. A host in the settings key is allowed.
- [ ] FIX-C3c. contracts/browser-tools.md line 206 is updated.
- [ ] FIX-C3d. m6-02-approvals-e2e.test.ts:100 uses the settings key.

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
