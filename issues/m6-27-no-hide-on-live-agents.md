# M6-27: No hide on live agents

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical (never slips, D81). Effort: 0.1 CC days. Depends on: none.

## Context

The x on every tile and list row hides the session in any state. A hidden `working` or `waiting_for_you` session keeps running, drops out of the live query, and never reaches "need you" again: the user loses an agent that may be waiting on them. Split out of M6-26 so it ships even if M6-26 slips (D81).

## Current state (verified 2026-10-12; find code by the quoted text)

- `workbench/renderer/terminal.js` `TILE_HTML`: `<button class="tx" data-action="hide" title="Hide this tile">` renders for every state.
- `workbench/renderer/app.js`: the list row x (`data-action="hide"`) renders for every state; `case 'hide'` sends `session.hide`.
- `core/src/methods.ts` `session.hide`: `UPDATE session SET hidden = 1 WHERE id = ?`, no state check.
- `workbench/src/queries.ts` live query: `WHERE hidden = 0 AND state IN ('working', 'waiting_for_you')`.
- `project.clear` already skips `starting`, `working` and `waiting_for_you`.

## Change

The tile x and the list row x render only when the session's state is not `starting`, `working` or `waiting_for_you`, the same set `project.clear` skips. A state change re-renders the header, so the x appears when the agent finishes. The core is unchanged.

## Acceptance criteria

- [ ] M6-27a. A tile and a list row for a session in each of `starting`, `working` and `waiting_for_you` have no element with `data-action="hide"`; in `done`, `idle` and `exited` each has exactly one.
- [ ] M6-27b. A session moving from `working` to `done` gains its tile x within one render.
- [ ] M6-27c. Each test states its card: `protects=`, `fails_when=`, `no_claim=`.
- [ ] M6-27d. The existing workbench suite still passes.

## Out of scope

- A state check inside `session.hide` in the core.
- Undo for hide (M6-26).

## Rules

Never commit, push or open PRs from an agent; hand back the command. Edit only your own lines in files other sessions have uncommitted changes in. No em dashes.
