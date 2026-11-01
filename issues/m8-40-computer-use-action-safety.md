# M8-40: Computer use action safety: no blind repeats, better answers to the agent

Part of Ouros, Milestone 8. Priority: High. Effort: 11.5 CC days. Depends on: none (extends M6-15, M6-2).
**Start on or after 2026-11-09. Do not push this file or file it as an issue until rows 1 and 5 are fixed locally:
the repo is public and this names open holes (same rule as the `fix-*.md` specs).**

## Source of truth

- `ouros-spec.md` section "Computer use and browser use (2026-11-02)"; `contracts/desktop-tools.md`, `contracts/approvals.md`.
- Research: scratch `ouros-computer-use-2026-11-02/lanes/desktop-harness/reply.md`.

## Code to pull

Ideas only. Each is rebuilt on Ouros's own grant and approval path.

| # | Change | Gap today | Read it at | Licence | Days |
|---|---|---|---|---|---|
| 1 | Hold repeats: store each risky action's outcome against `action_hash`; after `unverifiable` the same action is refused until a read proves the result or the user releases it | A retry of an unverifiable Send only asks for approval again, so a double send is possible | OpenAdaptAI/OpenAdapt `e3117c1` `packages/flow/openadapt_flow/write_ledger.py`, `verifier.py#L177-L222` (POSIX locks: take the idea, use a sqlite table) | MIT | 2 |
| 2 | Reject with an instruction: approve, reject, or reject plus text the agent receives, ending the rest of its batch | A rejection returns fixed text, so the agent has no steer | microsoft/magentic-ui `d3c9d13` `src/magentic_ui/teams/omniagent/_omni_agent.py#L515-L585`, `src/magentic_ui/approval.py` | MIT | 1 |
| 3 | Checked assertions: the agent proposes up to 8 typed checks on a named control's value or the window title; the core runs them with no model and returns what it found | Only `wait_for` and `confirmed` or `unverifiable` exist | AmrDab/clawdcursor `088689e` `src/core/verify/assertions.ts#L1-L110` (406 stars, young: idea only) | MIT | 2 |
| 4 | Change list: return capped added and removed nodes and value changes from the re-read the helper already does | The result does not say what changed | microsoft/magentic-ui `d3c9d13` `src/magentic_ui/teams/omniagent/_verifier.py` | MIT | 1.5 |
| 5 | Clean screen text: strip Unicode tag, zero-width and bidi characters and mark tool output as untrusted screen data | Snapshot text goes to the agent as read, scrubbed for secrets only | meta-llama/PurpleLlama `f64eebd` `LlamaFirewall/src/llamafirewall/scanners/hidden_ascii_scanner.py` (subfolder is MIT, repo licence reads NOASSERTION: idea only) | MIT | 1 |
| 6 | The agent can ask for take-over, and on resume is told what the user changed | Take-over is user-started only; nothing summarises the user's changes | bytebot-ai/bytebot `3d37894` `docs/guides/takeover-mode.mdx`, `packages/bytebot-agent/src/agent/agent.processor.ts#L376-L380` (archived 2025-09: design only); magentic-ui `_user_interjection.py` | Apache-2.0, MIT | 1.5 |
| 7 | Pin a grant to a record: the user can bind a grant to a title pattern; drift pauses the session | A grant binds hwnd, pid and process start; the title is never enforced | OpenAdaptAI/OpenAdapt `e3117c1` `packages/flow/openadapt_flow/guard.py` | MIT | 1 |
| 8 | Bind pixel clicks to their screenshot: refuse an older id or a front window the shot did not have. Build only if coordinate clicks are added for apps with no tree | Those apps get screenshots only | AmrDab/clawdcursor `088689e` `src/core/screen-binding.ts`, `src/tools/screen-guard.ts` | MIT | 2 |

Rows 1 and 7 change what a retry or a grant allows. The approval gate stays the real control; row 5 is defence in depth.

## Not pulled

- UFO's `prompt_sanitizer.py`: a regex phrase list, easy to evade.
- Sandboxes: nothing gives an agent its own Windows desktop on Windows 11 Home. Windows Sandbox needs Pro or higher.

## Acceptance criteria

- [ ] M8-40a. A click returning `unverifiable` is refused on the identical retry; a passing assertion or the user's release clears it.
- [ ] M8-40b. A rejection with text reaches the agent as that text, marked as coming from the user.
- [ ] M8-40c. A failed assertion returns the actual value, and no model is called to judge it.
- [ ] M8-40d. A window title holding Unicode tag characters reaches the agent without them, and the removal is logged.
- [ ] M8-40e. A session granted a pinned record pauses when the title stops matching.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Codex writes the tests for any part Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
