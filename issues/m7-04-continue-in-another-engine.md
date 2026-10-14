# M7-4: Continue in another engine

Part of the MetaTrooper desk epic, Milestone 7 (after the release). Priority: Medium. Effort: 1.5 CC days. Depends on: M6-24 (merged, 40d6d35). Start from `main` after the public release on 2027-01-19; record that `main` SHA as the base in the report.

## Source of truth

- `spec.md`: the Milestone 7 children table row M7-4, and the "Specced, built after the release" section, which names this child. D73 and D77 say why it is in this milestone.
- `ide-layer-research/idea-coverage.md` row core-sessions 11 ("Hand a session to another engine as a handoff document when a limit stops it").
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Context

When Claude hits its usage limit, M6-24 can resume the same session at reset. Often the user would rather carry on now in Codex or another engine. Today that means opening a new tile and retyping the task. This child adds one click that writes a short handoff and starts the chosen engine on it, in the same folder. It never happens on its own.

## Current state (verified 2026-10-14 on `main` 4fb7ef9 and every unmerged branch; find code by the quoted text, line numbers move)

| # | Fact | Where |
|---|---|---|
| 1 | A limit is detected only for Claude: `claude.StopFailure` with `error_type: 'rate_limit'` calls `limitHit`, which appends `core.limit-hit {window, resets_at, after}`. The state becomes `waiting_for_you`; there is no limit-stopped state or flag. `resumeAtReset` appends `core.limit-resumed {limit_hit}`. "Stopped by a limit" is a `core.limit-hit` with no later `core.limit-resumed`. | `core/src/events/processor.ts`; `core/src/sessions/limit-resume.ts`; `core/src/events/state.ts` |
| 2 | The tile shows only the "At reset: go on" toggle (`session.limit-resume`, column `limit_resume`), for Claude tiles. The workbench never reads `core.limit-hit`. | `workbench/renderer/terminal.js`; `app.js`; `core/src/methods.ts` |
| 3 | No task column: the wall's task line comes from `taskOf()` in the workbench (terminal title, else pipeline step, else where and when it opened). The title lives in core memory (`session.live-text`) and is lost on a core restart. | `workbench/src/queries.ts` `taskOf`; `contracts/schema.sql` `session.title` ("unused since M1-05") |
| 4 | No turn text is stored. `buildPayload` keeps `prompt_length` for `UserPromptSubmit`, and `session_id`, `transcript_path`, `cwd` for `Stop`; `codex.turn` keeps lengths only. Turn text exists only in the Claude transcript JSONL (path from the last `claude.*` event) and Codex's own session files under `~/.codex/sessions` (which `readCodexSession` already finds). | `core/src/redact.ts` `buildPayload`; `core/src/meter.ts` |
| 5 | Changed files: `session.owners {project_id}` returns `{repo, paths: [{path, owners: [{id, title, state}], shared, unclaimed}]}` from `core.claim` events, per project. `rowgit.ts` already filters it to one session. | `core/src/methods.ts`; `core/src/sessions/owners.ts`; `rowgit.ts` |
| 6 | No record of a failing command: Bash input is reduced to `{first_word, length}`, PostToolUse to `response_length`, and no exit code is kept. `interrupted-command` is about RPC methods. The Claude transcript holds each Bash `tool_use` and its `tool_result` with `is_error`. | `redact.ts`; `core/src/pipe/commands.ts` |
| 7 | No per-session folder: the nearest are `<home>/spool/<id>` (sandbox only) and `<home>/mcp/<id>`. Home is `METATROOPER_HOME` or `~/.metatrooper`. | `core/src/sandbox/spool.ts`; `core/src/plugins/mcp.ts` |
| 8 | `session.launch {project_id, engine_id, prompt?, host?, browser?, parent_id?}`: a prompt goes on argv for positional engines (claude, codex, pi), after a flag for agy, gemini and opencode, and is pasted for copilot. Argv travels as base64 JSON, so a 6 KB prompt is about 8 KB of command line, inside Windows' 32,767. `parent_id` makes `handBack` send the parent a notice when the child exits. Installed engines come from `engines.check` (`engine_check` table, `light()`). | `core/src/sessions/launch.ts` `planArgs`; `core/src/events/processor.ts` `handBack`; `workbench/src/queries.ts` |

## Change

1. **When it is offered.** A Claude tile whose session has a `core.limit-hit` with no later `core.limit-resumed`, and is not exited, shows a "Continue in..." button beside the reset toggle. It opens a menu of installed engines (`engine_check` green), the current engine left out. Nothing happens without that click; the limit path never calls it.
2. **The handoff file.** New UI method `session.continue {session_id, engine_id}` builds a Markdown file at `<home>/handoff/<session_id>-<n>.md` (n counts handoffs from that session) with, in this order:
   - `# Continue this task` and one line naming the source engine and that it stopped at its usage limit.
   - **Task**: the live title, else the first user prompt from the transcript, cut to 200 characters.
   - **Working folder**: the session's `cwd`.
   - **Changed files**: this session's paths from `ownersAsync`, at most 40, then "and N more".
   - **Last failing command**: from the transcript, the last Bash `tool_use` whose `tool_result` has `is_error: true`: the command (cut to 300 characters) and the first 20 lines of its output (cut to 1,000 characters). Left out when there is none or no transcript.
   - **Last turns**: up to 10, oldest first, each the user's prompt and the agent's final text reply of that turn, each part cut to 1,000 characters. Read from the Claude transcript; for a Codex source, from its session file. An engine with no readable transcript gets "no transcript was readable for <engine>".
   - Every part passes through `redactCredentials` and `redactSecretValues` with the known secret values.
3. **Fitting 6 KB.** The header, task, folder, changed files and failing command are written first. Turns are added newest first while the file stays at or under 6,144 bytes (UTF-8), then written oldest first. If the fixed parts alone pass 6,144 bytes, the changed files list is cut further, then the failing command's output.
4. **The launch.** The core calls `launchSession` for the same project with `engine_id`, `cwd` set to the source session's `cwd`, and the file's text as the prompt; no `parent_id`, so `handBack` never pastes into the stopped tile. It appends `core.continued {to, file}` on the old session and `core.continued-from {from, file}` on the new one, and the new tile shows "continued from <engine>" as resumed sessions show `resumed_from`. It sets the old session's `limit_resume` to 0, so it does not resume at reset in the same folder. The method returns `{session_id, file}`.

## Acceptance criteria

The first two are copied from `spec.md` and must not be reworded here.

- [ ] M7-04a. A limit-stopped fixture tile's "Continue in codex" writes a handoff file of at most 6 KB holding the task line and the last 10 turns, and launches codex with it as the prompt.
- [ ] M7-04b. The handoff file also lists the session's changed files and its last failing command; when the last 10 turns hold 1 KB each, the oldest are dropped first until the file fits 6 KB. A limit stop never switches engine without the click.
- [ ] M7-04c. The button shows on a Claude tile after `core.limit-hit` and is gone after `core.limit-resumed`; it never shows on a tile with no limit hit. The menu lists only installed engines and leaves out the source engine.
- [ ] M7-04d. A fixture transcript holding a secret value and an `sk-ant-` token in a turn writes neither into the handoff file.
- [ ] M7-04e. After Continue, the old session's `limit_resume` is 0, the new session runs in the old `cwd`, and the old tile receives no pasted text when the new session exits.
- [ ] M7-04f. A source with no readable transcript still writes a valid file with the task, folder, changed files and the "no transcript" line, and launches.
- [ ] M7-04g. Each test states its card: `protects=`, `fails_when=`, `no_claim=`.
- [ ] M7-04h. The existing core and workbench suites still pass.

## Testing plan

D65 does not list M7-4, so the implementing agent writes the tests, with the cards in rule 1.

| Layer | What | Count |
|---|---|---|
| Unit | b (fit rule with 1 KB turns), d (redaction), f, the failing-command reader on a fixture transcript | +4 |
| Core with a temp home and the fake engine | a, e (limit hit, continue, launch argv, `limit_resume`, no `handBack`) | +2 |
| Renderer | c (button and menu) | +1 |

## Rules for the implementing agent

1. Acceptance criteria are the `protects / fails_when / no_claim` profile of each test: never "make the tests pass".
2. Real code and real tests land in the same change.
3. Any change to an existing test, timeout or threshold is reported on its own line first, with its reason.
4. A reported command names the command and its observed result; stderr is never silenced in a cited command.
5. Your report is a claim until the parent re-runs it.
6. Never commit, push or open PRs; hand back the command. No em dashes; comments say what the code does.
7. Nothing here starts before the public release on 2027-01-19.

## Rollback

Revert the merge. Handoff files under `<home>/handoff/` and the two new event kinds are left behind and ignored by older code.

## Effort

0.5 turn and failing-command readers (Claude transcript, Codex session file), 0.25 the handoff builder and the 6 KB fit, 0.25 `session.continue`, launch, events and `limit_resume`, 0.25 the button and menu, 0.25 tests = 1.5 CC days.

## Files

| File | Change |
|---|---|
| `core/src/sessions/handoff.ts` | new: readers, builder, fit |
| `core/src/methods.ts` | `session.continue` |
| `core/src/paths.ts` | `handoffDir()` |
| `workbench/src/main.ts` | `session.continue` in `UI_METHODS` |
| `workbench/src/queries.ts` | limit-stopped flag per session (`core.limit-hit` without `core.limit-resumed`); `continued_from` |
| `workbench/renderer/terminal.js`, `app.js` | the button and engine menu |
| `contracts/pipe-protocol.md`, `contracts/events-and-hooks.md` | `session.continue`, `core.continued`, `core.continued-from` |
| `core/test/`, `workbench/test/` | the tests above |

## Out of scope

- Limit detection for engines other than Claude (only Claude reports it today).
- Continuing on its own when a limit hits (spec.md: by hand only).
- Handing back to the first engine after its reset.
- Deleting old handoff files.
