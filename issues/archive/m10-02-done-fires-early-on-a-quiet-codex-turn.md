# M10-2: "done" fired early on a quiet Codex turn

Part of M10-0 (launch), G3(g). Priority: High. **Status: DONE** (5b0cd8c9, merged into `launch/cc-1117` at 3bc088b6).

## What was wrong

A Codex rollout file that stayed quiet for 20 s marked the session done mid-turn. Most early "done" notices came from this quiet rule.

## Fix

- 5b0cd8c9: a quiet rollout file no longer marks a notify engine done; a Codex turn end comes from `notify`. agy keeps the quiet rule.
- Test: `core/test/fix-done-quiet.test.ts` (ecece453, written by a different engine than the fix). It fails on the code before the fix.

## Known limit

A Codex turn end now depends on `notify` alone. Low risk: cc always passes `notify` when it launches Codex.

## Acceptance checks

- [x] M10-02a. A Codex session whose rollout file is quiet for more than 20 s mid-turn stays working until `notify` reports the turn end (`core/test/fix-done-quiet.test.ts`).
- [x] M10-02b. The test fails on the code before 5b0cd8c9.

Status 2026-11-24: done, every box ticked. Archived by B4 (cc run 2026-11-24); 5b0cd8c9, core/test/fix-done-quiet.test.ts.
