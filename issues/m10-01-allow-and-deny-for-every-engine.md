# M10-1: Permission requests on Home, per engine

Part of M10-0 (launch), G3(g). Priority: High. Branch: `feat/g3-approvals-1117`.

## Decision for launch (2026-11-17)

Claude Code keeps its Allow and Deny card. Every other engine is terminal-only on Home, and cc never types an answer into its terminal for it: no approve or deny input has been captured live for those engines (same rule as M6-23). Wiring a real answer path is M10-3, after launch.

## What cc knows, per engine (checked 2026-11-17)

| Engine | Does cc know a permission prompt is waiting? | How the person answers | Notes |
|---|---|---|---|
| Claude Code | Yes (PermissionRequest hook plus transcript) | Allow and Deny on Home | `workbench/ui/src/chat.jsx:91-92`, keys from `chat-model.js:5` |
| opencode | Yes (`opencode.state` with `why: permission`, `core/src/events/processor.ts:228`) | In its terminal; Home shows "This agent asks for permission. Answer in its terminal." | The event has no request id, so cc cannot answer it |
| Codex | **May not.** cc reads `notify` (turn end) and rollout-file activity only | In its terminal; the tile shows the live terminal | Codex has a PermissionRequest hook; cc does not declare Codex hooks (M10-3) |
| Gemini CLI | **May not.** No attach | In its terminal; the tile shows the live terminal | Its hook can report a permission prompt but not answer it |
| Antigravity (agy) | **May not.** cc reads log-file activity only and cannot tell an approval wait from a slow tool | In its terminal; the tile shows the live terminal | agy has no permission signal in its terminal UI |

cc does not claim to flag a waiting permission prompt for Codex, Gemini CLI or Antigravity.

## Scope

| # | Change |
|---|---|
| 1 | When a terminal-only session waits with `wait_reason = 'permission'`, Home shows one plain line: "This agent asks for permission. Answer in its terminal." Same note style as the existing terminal-only note; no new design. |
| 2 | `approvalInput` stays `null` for every engine but Claude. |

## Out of scope

- Answering for other engines (M10-3).
- Approval policy or gate tokens (M8-21). Needs you Approvers already have Approve and Reject.

## Acceptance checks

- [x] M10-01a. A terminal-only session waiting with reason `permission` shows the line once (workbench test). (2026-11-24, B4 on a8a3b642 (own npm ci): workbench/test/m10-01-permission-note.test.ts 5/5)
- [x] M10-01b. The line is absent when the session works or waits for another reason. (2026-11-24, B4 on a8a3b642 (own npm ci): workbench/test/m10-01-permission-note.test.ts 5/5)
- [x] M10-01c. A Claude chat keeps Allow and Deny and never shows the line. (2026-11-24, B4 on a8a3b642 (own npm ci): workbench/test/m10-01-permission-note.test.ts 5/5)
- [x] M10-01d. `approvalInput` returns `null` for codex, agy, gemini and opencode. (2026-11-24, B4 on a8a3b642 (own npm ci): workbench/test/m10-01-permission-note.test.ts 5/5)
- [ ] Each test is written by a different engine than the code and fails on the code before the change where it guards new behaviour.
