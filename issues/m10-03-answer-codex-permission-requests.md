# M10-3: Answer Codex permission requests from cc (after launch)

Priority: Medium. After launch. Depends on: M10-1.

## Why

At launch cc may not know a Codex permission prompt is waiting; the person answers in the terminal (M10-1). Codex has a `PermissionRequest` hook that both reports the request and can return allow or deny, so cc can show the same Allow and Deny card it shows for Claude.

## Current state (2026-11-17)

- The Codex entry in `core/src/engines/registry.ts` uses `state_source: 'notify'` and declares no hooks. `codex.PermissionRequest` is already mapped in `core/src/events/state.ts` and `processor.ts`, but never arrives.
- Declaring Codex hooks replaces the notify arguments at launch (`install.ts`), so a `Stop` hook must take over turn ends, or "done" breaks.
- Codex runs a hook only after the person reviews and trusts it. The hook trust spike has never run.

## Scope

| # | Change |
|---|---|
| 1 | Spike: a trusted cc hook on a real Codex session receives `PermissionRequest` and its answer is honoured. Record the Codex version. |
| 2 | Codex entry declares `PermissionRequest` and `Stop` hooks; turn ends still reach cc (the M10-2 test stays green). |
| 3 | Home shows Allow and Deny for a Codex permission wait; the answer goes back through the hook, never as typed keys. |

## Out of scope

- Gemini CLI (its hook cannot answer), Antigravity (no signal), opencode reply endpoint (separate issue once a real opencode run exists).

## Acceptance checks

- [ ] M10-03a. On a real Codex session, Allow and Deny on Home each resolve one permission request, once.
- [ ] M10-03b. A Codex turn end still marks the session done after hooks are declared.
- [ ] M10-03c. With the hook untrusted, cc shows the terminal line from M10-1 and sends nothing.
