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

Tag: M5 (after 12-01, per M5-D11). Nothing here is built before launch.

### Ideas

| Id | Idea, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| CP-I1 | Score moments on hook, emotional peak and opinion, not length (Anil-matcha/AI-Youtube-Shorts-Generator) | `moments` | The prompt asks for `scores: {hook, peak, opinion}` (1 to 5 each) per item and orders `moments.json` by their sum. The `pick` gate's items view shows the three scores beside each title | On the fixture transcript, every item in `moments.json` carries all three scores and the list is sorted by their sum, highest first | 0.2 |
| CP-I2 | Chunk videos over 30 minutes with overlap (Anil-matcha/AI-Youtube-Shorts-Generator) | `transcribe` (`plugins/media/bin/media.js` `transcribe`) | When a file's probed duration is over 1800 s, the audio is split into 600 s chunks with 5 s of overlap. Each chunk goes through whisper, word times are shifted by the chunk start, and words inside an overlap are kept from the earlier chunk only | A 35 minute fixture gives `words.json` with strictly rising word start times, no word repeated across a chunk seam, and the last word within 2 s of the audio end | 0.5 |
| CP-I3 | One source, tailored per platform within its limits (trypostit/trypost, ShadowSlayer03/Post4U-Schedule-Social-Media-Posts) | `copy`, `schedule` (`social-scheduler.js` `refusal`) | `copy` already writes one post per clip per platform. Each `PLATFORMS` entry gains caption length and hashtag count limits, copied from that platform's posting docs with the doc URL beside them, and `refusal` checks them. Today only the YouTube title length is checked (`social-scheduler.js:66`) | A `posts.json` with one caption one character over the TikTok limit is refused before any upload, and the message names the clip, the platform and the limit | 0.3 |
| CP-I4 | Human approval before anything is scheduled (pendpost/pendpost) | `approve` | Already true: `pipelines/clips-to-scheduled-posts.json`, the `approve` gate sits before `schedule`, and `pick` gates the cut | Covered by the existing pipeline validation | 0 |
| CP-I5 | Idempotency keys so a retry never double-posts (ndesv21/socialclaw) | `schedule` (`social-scheduler.js` `schedulePost`) | After each post, the plugin appends `{key, clip, platform, slot, post_id}` to `<run>/scheduled.json`, where `key` is a hash of clip, platform and slot. A rerun skips every post whose key is already there. Today a partial failure asks the user to delete posts by hand before a rerun (`social-scheduler.js:104`) | With a fake API that fails on the third of four posts, a second run makes exactly one more `POST posts` call and `scheduled.json` ends with four keys | 0.4 |

Worked: 0.2 + 0.5 + 0.3 + 0 + 0.4 = 1.4 CC days.

### Hardening

| Id | Failure, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| CP-H1 | A platform rate limit gets the account flagged (ShadowSlayer03/Post4U-Schedule-Social-Media-Posts, ArmanShirzad/SocialMediaContentCreationAndPostingAutomationPlatform) | `schedule` (`social-scheduler.js` `realApi`) | On 429 or 5xx, `api()` waits for `Retry-After` when present, otherwise 2, 4 then 8 s, and tries again up to 3 times before throwing. Posts are sent at least 1 s apart. Today a 429 is marked retryable but thrown at once (`social-scheduler.js:48`) | A fake API that answers 429 twice then 200 schedules the post, and the recorded call times are at least 2 s and 4 s apart | 0.3 |
| CP-H2 | An expired token or disconnected account fails silently (zernio-dev/latewiz) | `schedule` (`schedulePost`) | Partly true: disabled integrations are filtered out and the post is refused as "no connected <platform> account" (`social-scheduler.js:74-80`). The change also treats Postiz's refresh-needed flag as not connected, and the refusal names the account's display name with "reconnect it in Postiz, then Resume" | A fake integration list where the TikTok account needs a refresh refuses the batch before any upload, and the message contains that account's name | 0.2 |
| CP-H3 | A 9:16 crop cuts out the speaker (faris-sait/openshorts) | `moments`, `cut` (`media.js` `cut`) | `cut` uses a fixed centre crop today (`media.js:116`). `transcribe` saves one still frame per scene in `<run>/frames/`. `moments` sets an optional `crop_x` (0 to 1, the speaker's horizontal centre) per item from those frames. `cut` centres the 9:16 window on `crop_x`, clamped to the frame edges, and defaults to 0.5 | A fixture moment with `crop_x: 0.1` gives a clip whose crop offset, read with ffprobe or a frame diff, sits at the left edge; without `crop_x` the clip is unchanged from today | 0.6 |
| CP-H4 | Raw video fills the disk (trypostit/trypost) | `ingest`, `schedule` | A local file input is read in place, not copied into the run folder (`media.js:84-88` copies it today). After `schedule` succeeds, `<run>/source` and `<run>/clips` (the uncaptioned cuts) are deleted and `<run>/styled` is kept. The input `keep_source: true` turns the cleanup off | After a fixture run with a fake API, `<run>/source` and `<run>/clips` are gone, `<run>/styled` holds every posted clip, and a local input file still exists | 0.3 |
| CP-H5 | A clip breaks a platform's media rules (ndesv21/socialclaw) | `schedule` (`refusal`) | `refusal` runs ffprobe on each clip and checks duration, aspect ratio, file size and codec against limits kept in each `PLATFORMS` entry (from the platform's docs, with the URL). Today it checks only that the mp4 exists (`social-scheduler.js:62`), and the `check` agent looks at framing, not file limits | A fixture clip longer than the YouTube Shorts limit is refused before any upload, with the clip, the platform, the measured duration and the limit in the message | 0.4 |

Worked: 0.3 + 0.2 + 0.6 + 0.3 + 0.4 = 1.8 CC days. Both tables: 1.4 + 1.8 = 3.2 CC days.
