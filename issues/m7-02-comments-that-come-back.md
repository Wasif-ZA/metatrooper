# M7-2: Comments that come back: threads, source file of a pick, mark-up, cross-origin picks

Part of the MetaTrooper desk epic, Milestone 7 (after the release). Priority: High. Effort: 6.0 CC days. Depends on: M7-1 (its cached isolated world and re-attach), M6-13 (merged: picks and the element stack), M6-18 (the agent cursor, for `reveal`), and M7-3's overlay hold mode (whichever of M7-2 and M7-3 lands first builds it). Start from `main` once those are merged; record that `main` SHA as the base in the report.

## Source of truth

- `spec.md`: the Milestone 7 children table row M7-2, and the "Specced, built after the release" section ("Comments that come back", "Source file of a pick", "Mark up", "Picks in cross-origin frames"), and D74. D73 and D77 say why it is in this milestone.
- `ide-layer-research/idea-coverage.md` names the mined ideas this child builds.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins. `contracts/browser-tools.md` gains four tools; `contracts/schema.sql` changes `comment`.

## Context

Today a comment on a page element goes to the agent once and is gone: the user cannot see whether it was dealt with. This child keeps each comment open until the agent resolves it, shows it as a pin on the page, lets the agent answer, names the component and source file behind a pick on the user's own dev server, adds a drawn mark-up, and makes picks work inside cross-origin frames.

## Current state (verified 2026-10-14 on `main` 4fb7ef9 and every unmerged branch; find code by the quoted text, line numbers move)

| # | Fact | Where |
|---|---|---|
| 1 | `comment` has `id, at, session_id, kind ('element','diff-line','file','notice'), body, crop_path, clipboard_at, prompt_at`: no status, thread, pane, URL or selector. The workbench is its only writer (schema header). Crops go to `~/.metatrooper/comments/<session>/<id>.png`. | `contracts/schema.sql` `comment`; `workbench/src/main.ts` `commentSave`, `saveComment` |
| 2 | A pick: `c` calls `startComment()`, `panePick`, `Panes.pick()` (`Overlay.setInspectMode searchForNode`), arrow keys walk `pickStack`, `describe()` takes outerHTML, a CSS path and a padded `Page.captureScreenshot` crop with no size cap, and `elementBody()` sanitises it to 4 KB. | `workbench/renderer/app.js` `startComment`; `workbench/src/browser/panes.ts` `pick`, `walkPick`, `describe`; `comments.ts` `elementBody` |
| 3 | Delivery: `comment.deliver` copies to the clipboard and, for engines without hooks, types the body into the terminal without Enter. For Claude, `deliverComments()` joins every row with `prompt_at IS NULL` into one `UserPromptSubmit` `additionalContext` and sets `prompt_at`. So picks before one prompt already go as one batch for Claude, and pile up in the input line for the rest. | `core/src/methods.ts` `comment.deliver`; `core/src/hook/event.ts` `deliverComments` |
| 4 | Browser tools: panes, navigate, back, snapshot, read, click, type, key, select, scroll, wait_for, screenshot, evaluate, console, network, dialog. No `comments`, `reply_comment`, `resolve_comment` or `reveal`, and no `(you pointed here)` marker. | `core/src/hook/browser-mcp.ts`; `workbench/src/browser/server.ts` `TOOLS` |
| 5 | The overlay view draws only the cursor. `DOM.getBoxModel` is used for click targets and pick crops. | `workbench/renderer/overlay.*`; `panes.ts` |
| 6 | D74's devtools-hook stub exists nowhere, and D74's "(M6-23)" is wrong: M6-23 is true status, and its issue never mentions a stub. This child owns it. No `__REACT_DEVTOOLS_GLOBAL_HOOK__`, `addScriptToEvaluateOnNewDocument` or fiber code on any branch. | `spec.md` D74; `issues/m6-23-*.md` |
| 7 | An owned dev port is a `session_dev_server` row with `status = 'ready'`. `Panes.policy()` reads it per session for `ownedPorts`; there is no "is this origin owned" helper outside the policy. | `panes.ts` `policy`; `core/src/browser/policy.ts` `checkUrl` |
| 8 | Child frames: `frames()` walks `Page.getFrameTree` and reads each frame's AX tree; a cross-origin frame (out of process) returns no nodes. No `Target.setAutoAttach`. | `panes.ts` `frames` |
| 9 | Redaction: `redactCredentials` (patterns) and `redactSecretValues` with `knownSecretValues()`. | `core/src/redact.ts`; `core/src/secrets.ts` |

## Change

1. **Threads.** Migration `00N-comment-threads.sql` adds to `comment`: `pane_id`, `url`, `frame_url`, `selector`, `status` (`'open'` default, `'resolved'`), `resolved_at`, `replies` (JSON array of `{at, by: 'agent'|'user', text}`, at most 20, each at most 2,000 characters), `markup` (JSON of shapes), and kind `'markup'` in the CHECK list. Existing rows become `open` with no pane and get no pin. `describe()` fills the new fields on a pick.
2. **Tools** (workbench browser server, which already writes `comment`):
   - `comments {pane_id?}`: open rows for panes this session drives: `id, pane_id, url, selector, body` (first 500 characters), `replies`.
   - `reply_comment {id, text}` and `resolve_comment {id, reply?}`: only for rows on panes this session drives; text passes `redactCredentials` and `redactSecretValues(knownSecretValues())` before it is stored; resolve sets `status`, `resolved_at`.
   - `reveal {ref}`: glides the session's cursor (M6-18) to the element's box and ripples, with no input.
   - The snapshot line of the element the user last picked in that pane (by `backendNodeId`, kept in memory per pane) ends with `(you pointed here)`.
3. **Pins.** A pane with open or recently resolved comments gets a "Comments (N)" toggle in its chrome bar. While on, the overlay runs in M7-3's hold mode and draws a numbered pin at each row's element: the selector is resolved in MetaTrooper's isolated world, its box read with `DOM.getBoxModel`, refreshed on scroll (the hold-mode binding) and resize. An open pin shows the comment on hover; a resolved pin is green for 24 h and shows the last reply on hover. A pin whose selector no longer matches is drawn greyed at the pane's top edge. Clicking a pin opens its thread with a reply box (a user reply appends `by: 'user'` and reopens a resolved row).
4. **Source file of a pick** (D74).
   - First step: a fixture React 18 app and a React 19 app on a fixture dev server. Record in this issue what a pick can read from each without any stub: the `__reactFiber$*` property on the DOM node, `_debugSource` (React 18 dev) and `_debugOwner`/`_debugStack` (React 19, which removed `_debugSource`).
   - On a pick, when the pane's port has a `ready` `session_dev_server` row (any session), a read-only `Runtime.callFunctionOn` in the page's main world walks the fiber from the picked node and returns up to 5 component names with `file:line` ("Component: <PricingCard> at src/components/PricingCard.tsx:42"). Vue (`__vueParentComponent`) and Svelte (`__svelte_meta`) give names only. Paths are made relative to the session's `cwd` when they are inside it, else dropped.
   - The 30-line `__REACT_DEVTOOLS_GLOBAL_HOOK__` stub D74 allows is added (`Page.addScriptToEvaluateOnNewDocument`, removed when the pane leaves that origin, and returning at once when `location.origin` differs) only if the first step shows a React version where names or `file:line` need it. Any other origin gets no stub and no main-world call.
5. **Mark-up.** `M` on a pane captures the viewport (`Page.captureScreenshot`, scale chosen so width x height stays at or under 4,000,000 px) and opens it in a full-pane editor in the renderer with pen, arrow, box and text (one colour, Ctrl+Z undo). Done flattens to one PNG; if it is over 2 MB it is scaled by 0.75 until it fits. The row is kind `'markup'` with `crop_path` the PNG and `markup` the shapes, and is delivered like a pick. A save path that receives an image over 4 MP refuses it with "image over 4 MP".
6. **Cross-origin frames.** On attach, `Target.setAutoAttach {autoAttach: true, waitForDebuggerOnStart: false, flatten: true}`; each child target's `sessionId` is kept per frame id. A pick inside an out-of-process frame runs `Overlay.setInspectMode` and `describe()` on that session (`dbg.sendCommand(method, params, sessionId)`), offsets the box by the frame owner's box in the parent, crops from the top-level page, and records `frame_url`. Snapshots of cross-origin frames stay as they are.

## Acceptance criteria

The first five are copied from `spec.md` and must not be reworded here.

- [ ] M7-02a. An agent calls `comments`, gets the user's open note, replies and resolves it; the pane's pin turns green and shows the reply, and the row reads resolved.
- [ ] M7-02b. A pick on a fixture React app served from an owned dev port names `<PricingCard>` and its `file:line`; the same app on a non-owned origin gets no stub (no `__REACT_DEVTOOLS_GLOBAL_HOOK__` defined by MetaTrooper) and no source line.
- [ ] M7-02c. A pick inside a cross-origin iframe returns that element, a crop of it, and the frame URL.
- [ ] M7-02d. A mark-up with an arrow and a box saves one PNG under 2 MB into the comment row.
- [ ] M7-02e. `reveal {ref}` flashes the session's cursor on that element. Three picks made before one prompt reach the agent as one batch. A reply holding a fixture secret value is stored redacted. A mark-up keeps its shapes as JSON in the comment row, and a 5 MP capture is refused at the 4 MP cap.
- [ ] M7-02f. The React 18 and React 19 first-step results are in this issue with the commands that produced them; on the fixture used for b, no main-world call is made on the non-owned origin (CDP log).
- [ ] M7-02g. `reply_comment` on a row from a pane the session does not drive fails and changes nothing; a 21st reply is refused.
- [ ] M7-02h. After the migration, existing rows keep their ids and bodies, read as `open`, and draw no pin.
- [ ] M7-02i. A snapshot after a pick marks exactly one line `(you pointed here)`, and none after a navigation.
- [ ] M7-02j. With pins on, a page MutationObserver records 0 changes, and a pin follows a 500 px scroll.
- [ ] M7-02k. Each test states its card: `protects=`, `fails_when=`, `no_claim=`.
- [ ] M7-02l. The existing core and workbench suites still pass, including M6-13's pick tests.

## Testing plan

D65 does not list M7-2, so the implementing agent writes the tests, with the cards in rule 1.

| Layer | What | Count |
|---|---|---|
| Core or workbench unit | migration (h), reply rules and redaction (e, g) | +2 |
| Electron, fixture pages | a, e (reveal, batch), i, j | +4 |
| Electron, fixture dev server (React 18, React 19, Vue) | b, f | +2 |
| Electron, two fixture origins | c | +1 |
| Electron, mark-up | d, e (shapes JSON, 4 MP) | +1 |

## Rules for the implementing agent

1. Acceptance criteria are the `protects / fails_when / no_claim` profile of each test: never "make the tests pass".
2. Real code and real tests land in the same change.
3. Any change to an existing test, timeout or threshold is reported on its own line first, with its reason.
4. A reported command names the command and its observed result; stderr is never silenced in a cited command.
5. Your report is a claim until the parent re-runs it.
6. Never commit, push or open PRs; hand back the command. No em dashes; comments say what the code does.
7. Nothing here starts before the public release on 2027-01-19.

## Rollback

Revert the merge. The migration only adds columns and a kind, so older code reads the table; `markup` rows show as an unknown kind.

## Effort

1.25 threads (migration, four tools, redaction, the snapshot marker), 1.0 pins (hold mode drawing, refresh, hover, thread box), 1.0 source file (the React 18 and 19 first step, fiber read, Vue and Svelte names, the stub only if needed), 1.25 mark-up (capture, editor, flatten, caps), 1.0 cross-origin picks (auto-attach, session routing, offsets), 0.5 tests = 6.0 CC days.

## Files

| File | Change |
|---|---|
| `core/src/store/migrations/00N-comment-threads.sql`, `contracts/schema.sql` | new columns and kind |
| `workbench/src/browser/panes.ts` | `describe()` fields, pick marker, pins, fiber read, stub, auto-attach and frame sessions, mark-up capture |
| `workbench/src/browser/server.ts`, `core/src/hook/browser-mcp.ts` | `comments`, `reply_comment`, `resolve_comment`, `reveal` |
| `workbench/src/main.ts`, `workbench/src/preload.cjs` | mark-up save, thread replies |
| `workbench/renderer/overlay.js`, `overlay.css` | pins |
| `workbench/renderer/app.js`, `browser-chrome.js`, new `workbench/renderer/markup.js` | Comments toggle, thread box, `M` key, the editor |
| `contracts/browser-tools.md` | the four tools and the marker |
| `workbench/test/`, `workbench/test/fixtures/` | the tests and fixture apps above |

## Out of scope

- Snapshots of cross-origin frames (pick only).
- Clicking the page while pins are shown (hold mode takes clicks; the toggle turns them off).
- Source lines for Vue and Svelte.
- Deleting resolved rows.
