# Epic: UI port, the wall and the pipeline layouts

Written 2026-10-05T13:11+11:00. Phases A to E. Status per phase: UI-STATUS.md, rows PORT-A to PORT-E.

The approved screens become the workbench: the wall (spec.md, Workbench) and one layout per pipeline run from
the library of 15 (spec.md, Pipeline UI). The mockups are fixture-driven HTML. The port re-implements them on
`ui.snap`; it does not paste them in.

Replaces the layout-A design of the UI revision (`issues/archive/`). The code under it stays: terminal core
(#33), status and inbox (#35), tools (#36) and result panes (#38).

## Decided

- All 17 pipeline screens approved 2026-10-05. Further changes come from dogfooding, not new design rounds.
- A step's `view` renders inside the active layout's output slot. There is no `view` migration.
- A background pipeline folds to a 36px wall bar.
- GSAP and the dither fonts are copied into `workbench/renderer/vendor/` and loaded locally (CSP is
  `script-src 'self'`).
- Field format and precedence are the contract's (`contracts/pipelines.md`, "Layout and background"). Where this
  epic and the contract differ, the contract wins.

## How it works

**Picking a layout.** For each run, `pickLayout(run)` returns one layout name. First that applies:

1. The user's key, 1 to 5 (the pipeline's five layouts in order). It holds until 0 or the run ends.
2. A failed step shows `run-log`. `design-variants` has no `run-log`, so its failure shows `agent-split` on the
   failing worktree.
3. The active step's `layout` hint.
4. The pipeline's pick rule: a small table per pipeline id in `workbench/renderer/layouts/rules.js`.
5. The pipeline's `layout`.

**When the screen moves.** A computed pick (2 to 5) is applied only when a gate starts waiting, a step fails, or
a step has run for 5 s. Never within 2 s of a click or key; a due change waits until 2 s after it. Keys 1 to 5
and 0 apply at once. The move is a GSAP glide.

**Background runs.** `background: true` renders the 36px wall bar: step, progress dots, elapsed time, the last
agent line, and one small live extra. The bar opens only when the pipeline's open rule fires (the "Opens when"
column in spec.md). Esc folds it and Enter opens it. Done, it settles as a calm bar that says `nothing needs you`.

**The view slot.** Each layout exposes one output region. The active step's `view` pane (#38's code in
`workbench/renderer/panes.js`) renders there. When the layout changes, the pane moves with it.

**Keys follow focus.** 1 to 5 and 0 act on an open run screen. 1 and 2 answer
a question when the focused tile is an agent asking one.

## Rules for every phase

- Each phase ends with its check and leaves the app usable.
- Codex writes the tests for every phase. Claude does not.
- Electron suites run alone. Overlapping runs flake and leave Electron processes behind.
- Before any real-window check, back up `~/.metatrooper/troop.db`: the first core start migrates it to v2. A
  Claude launch from the app installs hooks into `~/.claude/settings.json`; `troop hooks uninstall` undoes it.
- Screens for review use the demo instance with nothing personal visible.
- Never push or open PRs from an agent; hand back the command. No em dashes; comments say what the code does.

## Phase A: core wall

- **Scope.** The wall replaces the rail and centre terminal. Tiles reuse `terminal.js`. List on Ctrl+B, search
  on Ctrl+K (the palette code), the gate sheet, the inbox, Resume, the nine ideas, dither and charcoal themes.
  Diff, Hand-back, Browser, Runs and Pipelines open as overlays.
- **Check.** The existing workbench suite and the opt-in Electron suite pass, each run alone. UI-04 click counts
  are no worse than today's.
- **Files.** `workbench/renderer/index.html`, `app.js`, `style.css`, `terminal.js`, new
  `workbench/renderer/vendor/` (GSAP, fonts), `core/src/settings.ts` (dither default, charcoal theme).

## Phase B: layout picking and the first five layouts

- **Scope.** `layout` and `background` reach the window through `step_defs`. `pickLayout`, the glide timing,
  keys 1 to 5 and 0. Layouts `run-log` (reuses #37's `stepsOf()` step list), `artifact-columns`, `pr-first`,
  `pipe`, `agent-split`. The `spec-to-pr` pick rule.
- **Check.** A `spec-to-pr` fixture run shows the hinted layout per step; a failure shows `run-log`.
- **Files.** `workbench/src/queries.ts` (step_defs carry `layout`; pipelines carry `layout` and `background`),
  new `workbench/renderer/layouts/` with `rules.js`, `app.js`, `tests/fixtures/spec-to-pr/`.

## Phase C: background bar and the review layouts

- **Scope.** The 36px wall bar and the open rule. Layouts `pr-inline`, `duel`, `buckets`, `coverage-map`,
  `triage`. The `two-engine-review` pick rule.
- **Check.** The review fixture stays folded with no findings and opens to `duel` on a Disagree.
- **Files.** `workbench/renderer/layouts/`, `rules.js`, `app.js`, a two-engine-review fixture in `tests/fixtures/`.

## Phase D: product layouts

- **Scope.** Layouts `before-after`, `preview-stage`, `variants-grid`, `timeline`, `hand-back`. Pick rules for
  `e2e-browser-qa`, `website-build`, `design-variants` and `spec-build-review-handback` (below).
- **Check.** Each fixture opens in its rule's layout.
- **Files.** `workbench/renderer/layouts/`, `rules.js`, `tests/fixtures/e2e-browser-qa/`, `website-build/`,
  `design-variants/`, and a new `spec-build-review-handback` fixture.

### UI: `spec-build-review-handback`

This child carries the screen of Wasif's loop (milestone 1). Moved here from #37 on 2026-10-05.

Background. The run folds to the 36px wall bar with a small live terminal tail.

- Layouts: hand-back, artifact-columns (spec hinge), agent-split (session split), agent-split (worktree rail),
  run-log (thread). Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens when `approve-spec` waits, the hand-back list is written, or a verify or fix step fails. There is no
  pick-fixes gate: disputed findings land in the hand-back.
- Pick, first match: a failure to run-log; `approve-spec` to artifact-columns; the hand-back written to hand-back.
  Opened by hand: agent-split (session split) while a step runs. The worktree rail is by hand only.
- Steps (two-engine decision, 2026-10-04): spec, approve-spec (gate, approve), build (worktree, never commits),
  verify, two-engine-review run as a sub-pipeline, fix (only findings both engines agree on), re-verify and
  re-review, handback (disputed, unresolved and human-only items, numbered, nothing published).

## Phase E: pick rules for the 12 M3 pipelines

- **Scope.** Pick rules for the 12 pipelines owned by #15 to #25. Each is tested on its scratch `run.js` fixture,
  copied into `tests/fixtures/<id>/`. Their pipeline JSON and plugins stay with #15 to #25.
- **Check.** Each fixture picks the layout its spec.md row names.
- **Files.** `rules.js`, `tests/fixtures/<id>/` for each of the 12.

## Out of scope

- The 12 M3 pipelines' JSON and plugins (#15 to #25).
- Push, release and the installer (UI-02, #28).
- New design rounds.

## Related

- spec.md: Workbench, Pipeline UI, D44. `contracts/pipelines.md`: Layout and background, Result panes.
- Mockups (scratch): `~/.cache/claude-scratch/metatrooper-ui-fiveshot-2026-10-03/r5/r8/a-dither.html` (wall),
  `~/.cache/claude-scratch/metatrooper-lanes-2026-10-04/` (pipeline screens, LAYOUT-RULE.md, LAYOUT-LIBRARY.md).
