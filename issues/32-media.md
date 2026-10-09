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

Tag: M5 (after 12-01, per M5-D11). Nothing here is built before launch.

Specced 2026-10-09 against `pipelines/footage-to-edit.json` and `plugins/media/bin/media.js` on main `a350f46`.

### Ideas

| Id | Idea, from | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| FE-I1 | Cut dead air by threshold and margin, and only where the picture is static too, from WyattBlue/auto-editor, maxazure/video-editing-skill and ap-atul/Torpido | edit | `plugin:media` gains `silences`: ffmpeg `silencedetect` at -35 dB with a 0.4 s minimum on each take, trimmed by a 0.1 s margin each side, written to `<run_dir>/silences.json`. A silence that contains a scene change (`scenes`, `media.js:46`, run with `scenes: true`) is dropped from the list. `plan` reads the list and `edit` cuts only listed ranges instead of judging silences itself | A take with one 2 s silent gap on a still shot and one over a scene change: `silences.json` lists only the first, trimmed to 1.8 s | 0.75 |
| FE-I2 | Keep the last good take and drop the rest, from DayadaUP/claude-code-auto-video-edit | plan | A code step `takes` (`pipelines/footage-to-edit/takes.mjs`) after `transcribe` groups sentences whose first four words match and marks all but the last as dropped. A sentence followed within 2 s by a cue word (`again`, `cut`, `redo`) is dropped too. It writes `takes.json`; `plan` starts from it and must give a reason to keep a dropped take | Words with the same opening said three times: `takes.json` keeps only the third | 0.5 |
| FE-I3 | Cut at the transcript, not the timeline, from 0xsline/OpenChatCut | plan, edit | Cut times already come from word times (`plan` reads `words.json`; the `edit` prompt cuts at word boundaries). Change: `edit-plan.md` gives each kept range as word indexes into `words.json`, and a code step `cutlist` turns them into times with a 0.08 s pad, so the agent never types times | A plan keeping words 10 to 20: `cutlist.json` starts at word 10's start minus 0.08 s and ends at word 20's end plus 0.08 s | 0.5 |
| FE-I4 | Score candidates on several factors, merge overlaps, and show the reasons at approve-plan, from Anil-matcha/AI-Youtube-Shorts-Generator, Aseiel/VideoHighlighter and line/lighthouse | plan | `plan` adds a table to `edit-plan.md`: each kept range with a 1 to 5 score for brief fit, delivery and energy, and a one-line reason. Ranges that overlap by more than half are merged before scoring. `approve-plan`'s gate summary shows the number kept and the lowest score | Every kept range row has three scores and a reason, and no two rows overlap by more than half | 0.3 |
| FE-I5 | Score each render against the brief instead of a single pass or fail, from Visko-Platform/VEFX-Bench and KyaniteLabs/kinocut | visual-check | `visual-check` also writes `scores` (`brief` and `quality`, 1 to 5, each with a reason) to `flags.json`, and `approve-final`'s gate summary shows both. A brief score under 3 is a flag the edit step cannot fix, so it reaches the human | `flags.json` with `brief: 2`: the gate summary shows "brief 2/5" and `flags_left` is at least 1 | 0.3 |

Worked: 0.75 + 0.5 + 0.5 + 0.3 + 0.3 = 2.35 CC days.

### Hardening

| Id | Idea, from | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| FE-H1 | Whisper invents text over silence or noise, from znyupup/ai-video-editing-skill and Sirozha1337/faster-auto-subtitle | transcribe | `transcribe` (`media.js:51-79`) drops words whose span sits inside a silence from FE-I1's `silencedetect` pass, and passes whisper.cpp's no-speech threshold (`-nth 0.6`) when the binary supports it (checked once with `--help`). The output reports the count as `dropped_in_silence` | A take with 5 s of room tone after speech: `words.json` has no words in that span and `dropped_in_silence` is reported | 0.5 |
| FE-H2 | A cut lands mid-word or clips an onset, from WyattBlue/auto-editor and 0xsline/OpenChatCut | edit | Word-boundary cuts with 30 ms fades are asked for in the `edit` prompt only. Change: `cutlist` (FE-I3) is the only source of cut times, `edit` writes the cut times it rendered to `<run_dir>/edit/cuts.json`, and a code check after `edit` fails when any cut time lies inside a word's `[start, end]` in `words.json` | `cuts.json` with one cut 0.1 s into a word: the check fails naming the cut and the word | 0.3 |
| FE-H3 | Joining clips drops frames or drifts audio against picture, from znyupup/ai-video-editing-skill, maxazure/video-editing-skill and ThioJoe/Auto-Synced-Translated-Dubs | edit | `plugin:media` gains `render`: each range in `cutlist.json` is cut with the settings `cut` already uses (`media.js:118`, libx264 and AAC) at one frame rate and joined with the concat demuxer, with J-cut and pre-lap audio offsets from `edit-plan.md` baked in per segment. `edit` calls it instead of building its own ffmpeg command. After the render, the ffprobe audio and video durations must match within 40 ms | 5 ranges from two takes at 30 and 29.97 fps: `rough.mp4` passes the 40 ms check and its frame count is within 2 of the sum | 1.0 |
| FE-H4 | Captions cover the speaker's face or on-screen UI, from kurbaitaev/ghost-editor, 0xsline/OpenChatCut and RafaelGodoyEbert/ViralCutter | visual-check | Captions sit at a fixed bottom margin today (`media.js:141`, `MarginV 420`). Change: `visual-check` grabs one frame per caption line and flags any line that covers a face or UI text, naming the caption time; `edit` can then move that line to the top | A render with a face in the lower third: `flags.json` holds a caption overlap flag at that time | 0.5 |
| FE-H5 | The export fails on GPU, or the file will not play on the platform, from notivn/AIEV and KyaniteLabs/kinocut | approve-final | The GPU half is already true: renders encode on the CPU (`media.js:118`, `libx264`). Change: `render` (FE-H3) adds `-movflags +faststart`, and a code check before `approve-final` runs ffprobe on `out/final.mp4` and the 9:16 crop. Each needs an H.264 video stream, an AAC audio stream, a duration within 1 s of the plan's length estimate, and the moov atom first. A failure stops the run before the gate | A `final.mp4` with the moov atom at the end: the check fails with "not faststart" | 0.3 |

Worked: 0.5 + 0.3 + 1.0 + 0.5 + 0.3 = 2.6 CC days.
