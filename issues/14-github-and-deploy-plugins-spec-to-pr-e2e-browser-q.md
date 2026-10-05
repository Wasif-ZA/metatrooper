# `github` and `deploy` plugins; `spec-to-pr`, `e2e-browser-qa`, `website-build`, `design-variants`

Child #14 of the MetaTrooper epic. Milestone 2. Effort: about 2.5 Claude Code days.

Depends on: child #4, child #5, child #6, child #7, child #8.

## What

`github` and `deploy` plugins; `spec-to-pr`, `e2e-browser-qa`, `website-build`, `design-variants`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## Design (2026-10-02)

Each pipeline starts from its sketch in `ide-layer-research/pipeline-catalog.md` (#1, #2, #7, #14), cut to the
steps the runner already supports. Plugin actions are node scripts reading the action request on stdin, like
`plugins/agent-reach`.

### `github` plugin (`plugins/github`, built on `gh`)

| Action | External | Input | Output |
|---|---|---|---|
| `create-pr` | yes | `branch`, `base`, `title`, `body`, `cwd` | `url` (runs `git push -u origin <branch>`, then `gh pr create`) |
| `checks` | no | `pr` | `state`, `checks` (`gh pr checks --json`) |

### `deploy` plugin (`plugins/deploy`, built on the Vercel CLI)

| Action | External | Input | Output |
|---|---|---|---|
| `preview` | no | `cwd` | `url` (`vercel deploy --yes`) |
| `production` | yes | `cwd` | `url` (`vercel deploy --prod --yes`) |

The project id comes from `.vercel/project.json` in the worktree. Without it, both actions fail with
"link the project first: run `vercel link` in <cwd>"; they never run an interactive link.

### Pipelines (`pipelines/`, MIT)

- `spec-to-pr`: spec (plan, writes spec.md) -> approve-spec (gate) -> build (worker, worktree) -> verify
  (`repo/run-tests`) -> approve-pr (gate) -> open-pr (`github/create-pr`, publish).
- `e2e-browser-qa`: flows (plan) -> qa (visual-check, worktree, `dev_command`, browser pane; writes findings)
  -> fix (worker, same worktree) -> reverify (`repo/run-tests`) -> report (code step, no publish).
- `website-build`: design (plan, DESIGN.md) -> build (worker, worktree, `dev_command`, browser) -> critique and
  fix loop (max 3) -> preview (`deploy/preview`) -> approve (gate) -> production (`deploy/production`,
  publish).
- `design-variants`: board (`agent-reach/inspiration-board`) -> directions (plan) -> approve-directions (gate)
  -> variants (worker, fan-out 3, worktree, `dev_command`, browser, view `variants-grid`) -> pick (handoff gate:
  pick a tile, then Continue) -> polish (worker on the picked variant).

Cut from the catalog sketches, add when a real run shows the need: spec-to-pr's clarify step, task split and
4-way task fan-out with a review per task (one build agent does it all); website-build's Lighthouse step;
design-variants' image-model variants (variants are built as HTML in worktrees) and multiple feedback rounds.

Runner support added for this child: a step with `worktree: true` gets `worktree` and `branch` added to its
outputs by the runner, so later steps can name them (`{{steps.build.outputs.worktree}}`); validation accepts
those two keys without the step declaring them.

### Fixtures and the M2-01 check

`tests/fixtures/<pipeline id>/`: a small git repo with a static page served by `node serve.js --port <port>`
and one test. Tests run fake engines (`core/test/fake-engine.js` directives), a fake `gh` and a fake `vercel` on
PATH, and a local bare repo as `origin`. Each test asserts the run pauses at the gate whose `guards_step` is the
publish step, with an `action_hash`, before that step has run; then approves it and asserts the publish action
ran once against the fakes. Pipelines with no publish step assert they run to `done`.

## UI

Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic. `design-variants` UI: child #8.

### `spec-to-pr`

Foreground: the run holds the big slot from the start.

- Layouts: run-log, artifact-columns, pr-first, pipe, agent-split.
- Step hints: `spec` and `approve-spec` artifact-columns, `build` agent-split, `verify` run-log, `approve-pr` and
  `open-pr` pr-first. Pipeline fallback: pr-first.

### `e2e-browser-qa`

Background: the 36px wall bar with one small live browser thumbnail. A failing flow during `qa` is ink, not orange.

- Layouts: timeline (trace), run-log (command log), coverage-map (flow grid), before-after, timeline (session
  replay).
- Opens when the report leaves a finding open, `reverify` fails, or a critical finding lands (mid-run).
- Pick, first match: `reverify` failed to run-log; a critical finding to timeline at the broken frame; open
  findings on 3 or more flows to coverage-map; some fixed and some open to before-after; otherwise timeline.
  Session replay is by hand only. A clean run opened by hand shows before-after.

### `website-build`

Background: the 36px wall bar with one small live 390-wide site thumbnail.

- Layouts: preview-stage, before-after (critique pair), pipe (deploy lane), agent-split (build), run-log.
- Opens when `approve` waits, `critique` ends round 3 without `pass`, or `preview` or `production` fails.
- Pick, first match: a deploy failure to run-log; critique gave up to before-after; `approve` to preview-stage.
  Opened by hand: agent-split during `build`, before-after during `critique`, pipe otherwise and once live.

## Acceptance criteria

- [ ] M2-01. Each milestone-2 built-in runs end to end on its fixture and stops at every gate before a publish step.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
