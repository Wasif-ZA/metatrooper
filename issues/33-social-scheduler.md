# `social-scheduler` plugin and `clips-to-scheduled-posts`

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

Part of the MetaTrooper epic. Milestone 3. Effort: about 1.5 Claude Code days.

Depends on: child #32.

## What

`social-scheduler` plugin and `clips-to-scheduled-posts`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Background. The run folds to the 36px wall bar with a live clip thumbnail and its caption.

- Layouts: variants-grid (clip cards), preview-stage (clip stage), timeline (the week, platforms as tracks),
  pr-first (the batch), run-log. Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens when `pick` or `approve` waits, or any step fails, including a post the scheduler rejects.
- Pick, first match: a failure to run-log; `pick` to variants-grid; `approve` with a flag left to preview-stage on
  that clip and platform; `approve` otherwise to pr-first. Opened by hand: timeline with the hand-back when done,
  run-log while a step runs.
- Steps (two-engine decision, 2026-10-04): `ingest` (action, ingest), `transcribe` (action, worker), `moments`
  (agent, research, view items), `pick` (gate, handoff), `cut` (action, worker, fanout 4), `style` (action, worker,
  fanout 4), `copy` (agent, worker), `check` (agent, visual-check), `approve` (gate, approve, guards `schedule`),
  `schedule` (action, publish, external).

## Acceptance criteria

- [ ] M3-01. Each milestone-3 built-in runs end to end on its fixture and stops at every gate before a publish step.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.

## Helper tools (M4-8)

| Helper | Repo | Licence | Risk | Egress | Step it helps |
|---|---|---|---|---|---|
| OpenMontage Clip Factory | calesthio/OpenMontage | AGPL-3.0 | caution: AGPL plus Remotion's company tier; separate user-installed clone only | not checked | moments and cut |
| AI-Youtube-Shorts-Generator | Anil-matcha/AI-Youtube-Shorts-Generator | MIT | OK | not checked | moments and cut |
| FunClip | modelscope/FunClip | MIT | OK | not checked | moments |
| Remotion | remotion-dev/remotion | Remotion licence (source-available) | caution: free only for individuals, companies up to 3 staff, non-profits and evaluation | not checked | style |

Helpers are optional. Each pipeline runs without them. They are listed in `pipelines/assists/registry.json` once the pipeline is built (registry format in `issues/m4-09-helper-tools.md`).

## Ideas (M4-8)

### Requirements

- Flag low-confidence words: words under about 0.6 probability are listed per clip as flags before captions burn (SYSTRAN/faster-whisper, remotion-dev/remotion).
- Five-part moment score plus a standalone test: `moments` items carry `hook`, `coherence`, `value`, `energy`, `platform_fit` and a `standalone` pass or fail; rejected candidates are kept with their reason (calesthio/OpenMontage).
- Captions as data, checked in code: `transcribe` writes `Caption[]` JSON once; `style` renders from it and `check` verifies each page's text equals the transcript words in its window (remotion-dev/remotion).

### Notes

- Source coverage strip on the pick screen showing where each candidate sits in the source (calesthio/OpenMontage). Medium, S.
- Dedupe overlapping moments in code: over 50% overlap keeps the higher score (Anil-matcha/AI-Youtube-Shorts-Generator). Medium, S.
- Chunk long sources: above 30 min, run `moments` per 20-min chunk with 60 s overlap (Anil-matcha/AI-Youtube-Shorts-Generator). Medium, S.
- Pick by selecting transcript words, snapped to word timestamps (modelscope/FunClip). Medium, M.
- Aspect per clip with a crop-viability note; `check` fails a 9:16 clip that loses the speaker (calesthio/OpenMontage). Medium, S.
- Cheap caption stills with `npx remotion still --frame`; pass props as a file on Windows (remotion-dev/remotion). Medium, S.
- One failed clip does not sink the batch: a failed fan-out index goes `failed` with its error and `approve` shows it excluded (calesthio/OpenMontage). Medium, M.
- Gate card before `schedule` shows the exact request body, from a dry-run render (googleworkspace/cli). Medium, S.

## Repo scan 2026-10-09

Relevant repos, top ideas and hardening for `clips-to-scheduled-posts`: `ide-layer-research/m5-repo-scan-preview.md`, the section with the same name. Idea bank only; nothing there is built before launch (M5-D11).
