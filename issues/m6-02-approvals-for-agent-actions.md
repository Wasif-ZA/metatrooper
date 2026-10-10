# M6-2: Approvals for agent actions

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical. Effort: 3.0 CC days. Depends on: M6-1.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-2, and every section that names M6-2.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-02a. A browser `click` on a fixture button named "Send" creates one `approval` row in `waiting` and the call returns only after `approval.resolve`; rejected, the button's handler never runs (fixture counter stays 0).
- [ ] M6-02b. Focusing that button and calling `key {keys: "Enter"}` also creates an approval. Typing a string matching a credential pattern into a plain text field also creates one.
- [ ] M6-02c. `approval.resolve` without `ui.hello` returns -32012. A pending approval left 120 s returns "not approved in time" and the row reads `expired`.
- [ ] M6-02d. Approve for this session on a plain button covers the next click on it with no new row; renaming the button in the fixture voids it and asks again; typing into a password field asks every time.
- [ ] M6-02e. The same action computed in the MCP server and in the core gives the same `action_hash` (shared test vector in `contracts/approvals.md`).

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
