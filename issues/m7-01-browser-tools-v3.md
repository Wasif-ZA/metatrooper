# M7-1: Browser tools version 3: presets, numbered screenshots, batch, wider waits, covered tags, re-attach, WebMCP spike

Part of the MetaTrooper desk epic, Milestone 7 (after the release). Priority: High. Effort: 2.75 CC days. Depends on: M6-11, M6-12.

## Source of truth

- `spec.md`: the Milestone 7 children table row M7-1, and the `### M7-1:` section under Milestone 7. D73 and D77 say why it is in this milestone.
- `ide-layer-research/idea-coverage.md` names the mined ideas this child builds.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M7-01a. A session launched with `look` lists exactly 7 tools; `evaluate` fails -32034 naming `debug`; a launch with the preset `evalute` fails. A session with no preset lists every tool.
- [ ] M7-01b. A fixture with 12 buttons in view and 8 below the fold returns an annotated screenshot whose legend has exactly 12 entries; afterwards a DOM query finds 0 overlay nodes.
- [ ] M7-01c. On a login fixture whose refs come from one snapshot, `type`, `type`, `click`, `wait_for {url_includes}` run in 1 `batch` call with 4 results. With step 2 on a removed ref, steps 3 and 4 read `skipped` and the pane has 2 `browser.tool` rows from the batch. A step on a D61 risky button waits for its approval; rejected, the steps after it read `skipped`. A `look` session's batch holding `click` fails -32034 before any step runs.
- [ ] M7-01d. A 10 s `wait_for` makes at most 1 `Page.createIsolatedWorld` call. A page that removes "Loading" at 1.5 s resolves `text_gone` within 2 s. `timeout_ms: 60000` returns `clamped_to_ms: 30000`. A navigation then an `evaluate` makes exactly 1 new world. `url_includes: "/done"` resolves within 500 ms of a fixture redirect; `idle_ms: 500` resolves 500 to 700 ms after the last fixture request.
- [ ] M7-01e. A fixture with 10 buttons, 4 under a modal and 3 below the fold, tags exactly 4 `[covered]` and 3 `[offscreen]`. On a 400-ref page the snapshot takes at most 1.2 times as long as without tags.
- [ ] M7-01f. After a forced `dbg.detach()`, within 1 s a `click` works, a request policy blocks is still blocked, and a parked pane still reports its parked viewport width. The laptop check's result is in the issue; DevTools opens docked (`mode: 'bottom'`) if it passed and detached if not.
- [ ] M7-01g. The WebMCP spike's result (pass or fail, Electron version, the switch used if any) is in `issues/m7-01-browser-tools-v3.md`; if it passed, a fixture registering 3 tools (1 consequential) lists 3, a call to the consequential one creates one `approval` row and runs only after approval, `page_call` fails under `look`, and an unknown name lists the 3 names.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for this child (D65), with a mutation run that must fail at least one test.
- Nothing here starts before the public release on 2027-01-19.
- No em dashes; comments say what the code does, not why.
