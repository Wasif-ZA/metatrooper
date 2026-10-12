# Approvals for agent actions

Version 1 (M6-2, D55, D61). The core decides; MCP servers ask. Code: `core/src/approvals.ts`.

## Flow

1. Before every input call (browser: `click`, `type`, `select`, `key`), the MCP server describes the target: the
   pane's origin and the control the call acts on (the ref's node, or the focused element for `key`, found through
   open shadow roots and same-origin frames).
2. It sends `approval.check` to the core and waits (up to 120 s plus a margin) for the answer.
3. `allow` or `approved`: it sends the call with `expect: {name, automation_id, origin}`, the control and origin it
   checked. The workbench re-reads them after the cursor glide, right before dispatch; a different origin, Name or
   AutomationId fails with -32035 and nothing is sent. The MCP server then checks again (at most 3 rounds).
4. `rejected` returns "not approved: the user rejected this action"; `expired` returns "not approved in time";
   `deny` returns "not sent: <reason>". The agent is never told how to approve.
5. Core offline: the call is not sent ("the MetaTrooper core is offline, so this action cannot be checked").

## Methods

| Method | Params | Result |
|---|---|---|
| `approval.check` | `{session_id, surface: "browser"\|"desktop", target, action, args, control, password?, hidden?, file_dialog?, action_hash?}` | `{decision: "allow"}`, `{decision: "deny", reason}`, or `{decision: "approved"\|"rejected"\|"expired", approval_id}` once the row is decided. Never queued. -32602 when `action_hash` is given and differs from the core's own hash |
| `approval.resolve` | `{approval_id, decision: "approve"\|"reject", scope?: "once"\|"session"}` | `{status, scope}`; needs `ui.hello` (-32012); -32002 unknown id; -32010 when the row is not `waiting` |

`target` is the origin for the browser and the grant id for the desktop. `control` is
`{automation_id, name, role}` with empty strings for missing parts, or `null`. In the browser, `automation_id` is the
element's `id` attribute and `name` and `role` come from the accessibility tree.

## Rules (D61)

The first matching rule is the row's `reason`. No match means `allow`.

| Reason | When | Session scope |
|---|---|---|
| `file dialog` | `file_dialog: true` (desktop) | never; asks every time |
| `hidden control` | `key` of Enter, Space or a Ctrl/Alt/Meta shortcut while focus is in a cross-origin frame or a closed shadow root (`hidden: true`), so the control cannot be named | never |
| `password field` | `type` into a password field (`type=password`, UI Automation `IsPassword`) | never |
| `credential text` | `type` whose text matches a credential pattern (`CREDENTIAL_PATTERNS`, or a 32+ character token run mixing digits, lower and upper case, in `core/src/redact.ts`) | never |
| `credential field` | `type` into a control whose Name or AutomationId has the word password, passcode, token, secret, key, cvv or card | never |
| `risky control: <name>` | `click`, `select` or `type` on a control whose Name or AutomationId has the word send, submit, pay, buy, purchase, order, checkout, delete, remove, erase, publish, post, transfer, authorize (authorise) or confirm; `key` of Enter, Space or a Ctrl/Alt/Meta shortcut while such a control has focus | yes |

Words are matched whole, case-insensitively, after camelCase, `_`, `-` and `.` are split (`sendButton` matches). English
only. Plain `key` presses (Tab, letters, arrows) never ask.

## Scopes

- `once` approves the call that asked.
- `session` approves the same `action` on the same `target` and the same `control` (the stored JSON text, exact) for
  the rest of the session, with no new row. Renaming the control makes a different `control` and asks again.
- Rows whose reason never takes session scope are stored with `scope: once` whatever was asked.
- A row waiting 120 s becomes `expired` and its call returns "not approved in time". Rows still `waiting` when the
  core starts become `expired`.
- Each waiting row has a `needs_you` row of kind `approval` with `ref` = the approval id and `text` = the summary; it
  is resolved when the approval is decided or expires.

## Redaction

`summary`, `reason` and `control` pass through `redactCredentials` before they are stored. Typed text is never stored;
`approval.check` is never queued, so it never reaches the `command` table.

## action_hash

sha256 hex of the UTF-8 JSON text of `{"action","args","control","session_id","surface","target"}` with keys sorted
at every level, no whitespace, strings as `JSON.stringify` writes them (non-ASCII not escaped), and keys whose value
is undefined left out. Before hashing, `args.text`, when it is a string, is replaced by its own sha256 hex. The MCP
server sends its hash; the core recomputes it and refuses a mismatch.

Test vector 1:

```
input   {"action":"type","args":{"pane_id":"bp_agent_1","ref":"e7","text":"hunter2"},
         "control":{"role":"textbox","name":"Password","automation_id":"pw"},
         "session_id":"s_01J0000000000000000000000","surface":"browser","target":"http://127.0.0.1:5173"}
text    sha256("hunter2") = f52fbd32b2b3b86ff88ef6c490628285f482af15ddcb29541f94bcf526a3f6c7
hashed  {"action":"type","args":{"pane_id":"bp_agent_1","ref":"e7","text":"f52fbd32b2b3b86ff88ef6c490628285f482af15ddcb29541f94bcf526a3f6c7"},"control":{"automation_id":"pw","name":"Password","role":"textbox"},"session_id":"s_01J0000000000000000000000","surface":"browser","target":"http://127.0.0.1:5173"}
hash    2bc66d4862c28c52d492ee0ef5c8f4ca335a0ada3b0bf7d05ad0fc69e9067380
```

Test vector 2 (no control):

```
hashed  {"action":"click","args":{"ref":"e3"},"control":null,"session_id":"s1","surface":"browser","target":"https://example.com"}
hash    c404f4dab0098ef9509fe95259dedae2df269451201bd44cadeea770ac326d0c
```

## Known limits

- A process that calls the browser pipe directly, without the MCP server, is not checked (Threat model: a hostile
  same-user process is out of scope).
- Risky words are English only.
- The bottom-sheet card shows the summary and reason; the redacted crop (`shot`) is not taken yet.
