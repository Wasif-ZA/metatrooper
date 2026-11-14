# M8-5: Source tagging tied to the real gate system

Part of Ouros, Milestone 8. Build step G5. Priority: Critical. Effort: not sized (sized after M8-0). Depends on: M8-2, M8-21.

## Source of truth

- `ouros-spec.md` section 3, 7; `spec.md` Milestone 8 children table row M8-5.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

Only Ouros draws the needs-you colour or a real gate. An agent-drawn gate is a grey "<agent> asks you, not a gate" card. A real gate is answered with a single-use token for one exact action and hash.

No screen: a decision card in Needs you, with toggles in Settings > Reliability > Asking.

## Blocked on

- NEWFEATURES.html keep/change/drop on f-intent.

## Acceptance criteria

As built: the `gate` part is in the catalogue but not drawn, so an agent's gate becomes a plain-text box. Agent parts never use the needs-you colour (`workbench/test/m8-01-kit-parts.test.ts`, "never draw the needs-you colour").

- [ ] M8-05a. An agent-drawn gate cannot resolve a real gate (test).
  Status: PARTIAL. Holds today only because `gate` is not drawn and `ui.event` only queues text. The grey "<agent> asks you, not a gate" card is not built.
  Verify (passes now): `cd core; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="ui.show reports and stores" test/m8-02-ui-surface.test.ts` (case "undrawn root").
  Verify (to write): `core/test/m8-05-source.test.ts` test "a click on an agent-drawn gate leaves every approval row pending".
- [ ] M8-05b. An event named "approve" from an agent surface reaches that agent as plain text only.
  Status: PARTIAL. `ui.event` only writes a comment notice or a needs-you row, never an approval. Untested.
  Verify: to write, `core/test/m8-05-source.test.ts` test "event approve becomes one [ouros-ui] notice and changes no approval".
- [ ] M8-05c. On agent surfaces the asker's name is the real agent, never the `from` it sends (spoofed-name test).
  Status: PARTIAL. The tab bar names the real session ("drawn by session ..."), and `choice` does not draw its `from` prop. Untested.
  Verify: to write, `workbench/test/m8-01-kit-parts.test.ts` test "choice with from: Ouros never draws that name".
- [ ] M8-05d. Clarify inside the plan gate: only when the ambiguity changes what gets done, the plan gate offers two readings and lists the files it plans to touch; an edit outside that list is flagged.
  Status: NOT STARTED. Same work as M8-F5.
  Verify: to write, `core/test/m8-05-plan-gate.test.ts` test "an edit outside the plan's file list is flagged".

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
