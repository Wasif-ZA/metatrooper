# `media` plugin and `footage-to-edit`

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

Part of the MetaTrooper epic. Milestone 3. Effort: about 2.5 Claude Code days.

Depends on: child #15, child #16.

## What

`media` plugin and `footage-to-edit`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Background. The run folds to the 36px wall bar with a small programme strip showing cut ticks.

- Layouts: timeline (text view and strip mode are toggles), preview-stage (screening room), before-after (cut
  pair), pipe (take cards), run-log. Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens when `approve-plan` or `approve-final` waits, the last `edit` pass leaves a flag `left for you`, or any step
  fails.
- Pick, first match: a failure to run-log; `approve-plan` to timeline in text view; `approve-final` to
  preview-stage; a flag left before `approve-final` to before-after on that cut. Opened by hand: preview-stage with
  the hand-back once approved, pipe while a step runs.
- Steps (two-engine decision, 2026-10-04): `inventory`, `transcribe`, `plan`, `approve-plan` (gate, approve),
  `edit`, `visual-check` (loop with `edit`, max 2), `approve-final` (gate, approve). No external or publish step.

## Acceptance criteria

- [ ] M3-01. Each milestone-3 built-in runs end to end on its fixture and stops at every gate before a publish step.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.

## Helper tools (M4-8)

| Helper | Repo | Licence | Risk | Egress | Step it helps |
|---|---|---|---|---|---|
| auto-editor | WyattBlue/auto-editor | Unlicense | OK | none (local video tool) | edit |
| faster-whisper | SYSTRAN/faster-whisper | MIT | OK | none (local transcription) | transcribe |
| Remotion | remotion-dev/remotion | Remotion licence (source-available) | caution: free only for individuals, companies up to 3 staff, non-profits and evaluation; other companies need a paid Company Licence | not checked | edit |
| OpenMontage | calesthio/OpenMontage | AGPL-3.0 | caution: AGPL; bundles Remotion, so Remotion's company tier also applies. Use as a separate user-installed clone only | not checked | plan and edit |

Helpers are optional. Each pipeline runs without them. They are listed in `pipelines/assists/registry.json` once the pipeline is built (registry format in `issues/m4-09-helper-tools.md`).

## Ideas (M4-8)

### Requirements

- "What was cut" reel: `--when-active cut --when-inactive nil` renders only the removed parts as their own short file, shown beside the edit with the removed total, before `approve-final` (WyattBlue/auto-editor, calesthio/OpenMontage).
- Code pre-check before the visual agent: ffprobe validation, frames at 4 positions, audio levels and subtitle presence run as a code step; only a pass goes to the agent, a fail goes back to `edit` with the reason (calesthio/OpenMontage).

### Notes

- Timeline from auto-editor v3 JSON: `plan` writes its keep list in v3 shape and the `timeline` layout draws it (WyattBlue/auto-editor). Medium, M.
- Hand the edit to a real editor: one hand-back line per installed NLE via `--export premiere`, `resolve`, `final-cut-pro` (WyattBlue/auto-editor). Medium, S.
- Silence padding: keep the 400 ms threshold but add 0.08 to 0.2 s padding to the `edit` prompt so word onsets are not clipped (WyattBlue/auto-editor, calesthio/OpenMontage). Medium, S.
- Faster transcription on CPU: use the batched pipeline when RAM allows (SYSTRAN/faster-whisper). Medium, S.
- Speed through silence instead of cutting: the plan picks cut or speed-up per section by target platform (calesthio/OpenMontage, WyattBlue/auto-editor). Low, S.

## Repo scan 2026-10-09

Relevant repos, top ideas and hardening for `footage-to-edit`: `ide-layer-research/m5-repo-scan-preview.md`, the section with the same name. Idea bank only; nothing there is built before launch (M5-D11).
