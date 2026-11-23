# M7-21: Demo and isolated instances read nothing from the owner's home

Part of the MetaTrooper desk epic (becoming Ouros), Milestone 7. Priority: High. Effort: not sized. Depends on: none.
Status: bug confirmed in code 2026-10-31.

## Source of truth

- ~/.cache/claude-scratch/metatrooper-demo-2026-10-03/BUGS.md
- core/src/limits.ts:34, :75 (home = os.homedir())
- core/src/main.ts:141 (readLimits(db) with no home)
- tests/demo/seed.mjs
- issues/m5-11-site-and-demo.md

## What is open

- A METATROOPER_HOME demo instance still reads ~/.codex/sessions, so its usage meter shows the owner's real Codex usage in README shots and GIFs.
- Re-check on current main: troop launch claude --prompt exiting at once; the trust dialog defaulting to "No, exit" on Enter; Codex rows garbling after a resize (overlaps M7-8).

## Acceptance criteria

- [x] M7-21a. readLimits takes its engine home from the instance home or a setting, never os.homedir(), when METATROOPER_HOME is set. (2026-11-08: `engineHome()` in core/src/paths.ts.)
- [x] M7-21b. A test seeds a fake ~/.codex and asserts the demo meter ignores it. (2026-11-08: core/test/m7-21-demo-limits.test.ts; fails without the fix.)
- [x] M7-21c. A --demo run shows zero real usage figures on a frame capture. (2026-11-24: B3 ran `electron . --demo` on a8a3b642; frame after 25 s shows no usage strip, orch1124/b3/m7-21c-demo.png; core/test/m7-21-demo-limits.test.ts 3/3 pass.)
- [x] M7-21d. Each of the three unverified bugs is reproduced or closed with a dated note. (2026-11-24, see the note below.)
- [ ] M7-21e. M5-11 recording steps drop the DOM-hide workaround for meters. (2026-11-08: no DOM-hide step is in issues/m5-11 or tests/demo; nothing to drop in the repo.)

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for any fix Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.

## M7-21d note, 2026-11-24 (B3, isolated core with METATROOPER_HOME in its lane folder, Claude Code v2.1.330)

1. `troop launch claude --prompt` exits at once: closed, not reproduced. In a trusted folder the prompt ran ("pong")
   and the session went to done; in an untrusted folder it stays live (waiting_for_you) on the trust dialog.
2. The trust dialog defaults to "No, exit" on Enter: reproduced; the cursor sits on "No, exit". It is Claude Code's own
   dialog, and Wasif's Q2 answer (2026-11-24) says leave it and answer in the terminal. Closed as won't fix.
3. Codex rows garble after a resize: moved to M7-8 (rows 6 and 11; criteria M7-08e and M7-08j). Closed here.

Status 2026-11-24: done. 21a,b by engineHome() and core/test/m7-21-demo-limits.test.ts (3/3 pass on a8a3b642, run by B4); 21c,d by B3 on the orch1124 board, 00:39.
