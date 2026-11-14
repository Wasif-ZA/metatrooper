# M8-3: Events back to the agent, and form state

Part of Ouros, Milestone 8. Build step G3. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-2.

## Source of truth

- `ouros-spec.md` section 3; `spec.md` Milestone 8 children table row M8-3.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

A click on an agent-drawn button goes back to the session that drew it as its next message, prefixed `[ouros-ui]`. No polling tool.

## Acceptance criteria

As built (merge 6a9f83f7): core `ui.event` (`surfaceEvent` in `core/src/surfaces.ts`) takes `{surface, seq, event, context}` and queues one `[ouros-ui] {...}` line as a comment notice, the way `comment.deliver` does. Engines without hooks get it typed into the terminal. Claude gets it from the UserPromptSubmit hook (`core/src/hook/event.ts`). No test calls `ui.event` yet, so every criterion here is PARTIAL.

- [ ] M8-03a. A click delivers `{surface, event, context}` to the owning session within one turn.
  Status: PARTIAL. Built, untested. For Claude the line waits for the next UserPromptSubmit, so an idle Claude session does not see the click until someone types.
  Verify: to write, `core/test/m8-03-ui-event.test.ts` test "a click on a live surface queues one [ouros-ui] line with surface, seq, event and context".
- [ ] M8-03b. Fields carry required, disabled, invalid and error states.
  Status: PARTIAL. `parts-c.jsx` field maps `required`, `disabled`, `invalid` and `error` to astryx props. The `field` fixtures in `m8-01-kit-parts.test.ts` set none of them.
  Verify: to write, `workbench/test/m8-01-kit-parts.test.ts` test "field: required, disabled, invalid and error each render their state".
- [ ] M8-03c. A stale or repeated click is dropped.
  Status: PARTIAL. Built (`dropped: 'stale'` when seq is old, `dropped: 'repeat'` for the same event at the same seq), untested.
  Verify: to write, `core/test/m8-03-ui-event.test.ts` tests "an old seq is dropped as stale" and "the same event twice at one seq is dropped as repeat".
- [ ] M8-03d. A click after the session ended lands in the needs-you inbox.
  Status: PARTIAL. Built for sessions in state `exited`, untested.
  Verify: to write, `core/test/m8-03-ui-event.test.ts` test "a click on an exited session's surface becomes one needs_you row".
- [ ] M8-03e. A question (`choice` the agent waits on) never resolves by time passing; it waits until answered or withdrawn.
  Status: PARTIAL. `ui.event` has no timer, but nothing tests it and there is no "withdrawn" path.
  Verify: to write, `core/test/m8-03-ui-event.test.ts` test "a surface with no click stays undelivered after the clock moves a day".

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
