# M10-1: Allow and Deny on a permission request for every launch engine

Part of M10-0 (launch), G3(g). Priority: High. Effort: not sized. Depends on: none.

## Current state (checked 2026-11-17 on f57c4c89)

- Home chat shows Allow and Deny on a permission request (d73d0654, 0cec1637): `workbench/ui/src/chat.jsx:91-92`.
- The keys sent come from `approvalInput` in `workbench/ui/src/chat-model.js:5`. It returns `'1'` / Esc for Claude and `null` for every other engine, so both buttons are disabled for Codex and agy and the person must type into the terminal.
- The screen walk of the 11-10 build found a free-text answer box and no Allow or Deny at all for `wait_reason=permission`.
- Browser-pane site permissions already have Allow and Block (`workbench/renderer/app.js:240`); not part of this issue.

## Goal

When a session waits on a permission request, the person can answer it with one click or one key, for every engine cc launches (Claude Code, Codex, agy). The free-text box is not the only way.

## Scope

| # | Change |
|---|---|
| 1 | Find, from a real capture per engine, the input that approves and the input that denies a permission prompt. Only live-captured inputs ship (same rule as M6-23). |
| 2 | `approvalInput` returns those inputs for each engine with a capture; it stays `null` for an engine without one, and the chat says "answer in the terminal" for it. |
| 3 | Wherever Home shows a session that waits with `wait_reason=permission`, Allow and Deny replace the free-text box; the "Ask an agent" composer hides while that session needs you. |
| 4 | One answer per request: buttons lock after the first click (as 0cec1637 does for Claude). |

## Out of scope

- Approval policy or gate tokens (M8-21).
- Needs you Approvers (reviewer approvals): already has Approve and Reject.

## Acceptance checks

- [ ] M10-01a. For each engine with a capture, Allow sends the captured approve input and Deny the captured deny input, once (unit test on `approvalInput` plus a chat test per engine).
- [ ] M10-01b. An engine with no capture shows both buttons disabled with the terminal note; nothing is sent.
- [ ] M10-01c. A second click after an answer sends nothing.
- [ ] M10-01d. A session waiting with `wait_reason=permission` on Home shows Allow and Deny and no free-text box (workbench test).
- [ ] Each test fails on f57c4c89 (mutation check), and is written by a different engine than the code.
