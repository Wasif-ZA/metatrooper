# FIX-C10: session.launch contract omits approval and the sandbox host

From the 2026-10-31 audit of core. Severity: Low. Effort: S unless the fix says otherwise.

## Where

- core/src/methods.ts:66; contracts/pipe-protocol.md:137

## What goes wrong

The documented params and result miss `approval`, `host: "sandbox"`, and the `approval` and `setup` result fields. The table is generated from METHODS.

## Fix

Update METHODS and regenerate pipe-protocol.md.

## Audit

Read-only audit of core/src, 2026-10-31. Tests at audit time: `node --test "test/*.test.ts"` in core, 726 tests, 715 pass, 0 fail, 11 skipped.

## Acceptance criteria

- [ ] FIX-C10a. METHODS lists approval?, host?: "pty"|"sandbox" and the extra result fields.
- [ ] FIX-C10b. The regenerated table matches.
- [ ] FIX-C10c. The contract says how an approval above the caller's level is handled (FIX-C2).

## Rules

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- All fixes from this audit go on one fix branch (`fix/audit-2026-10-31`), one commit per FIX.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the failing test first for any fix Claude builds.
- No em dashes; comments say what the code does, not why.
