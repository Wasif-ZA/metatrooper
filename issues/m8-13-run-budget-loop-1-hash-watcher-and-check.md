# M8-13: Run budget, loop 1, hash watcher and checkpoints

Part of Ouros, Milestone 8. Build step G13. Priority: Critical. Effort: not sized (sized after M8-0). Depends on: M8-3.

## Source of truth

- `ouros-spec.md` section 6e, 7; `spec.md` Milestone 8 children table row M8-13.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

The product core: agents fix their own mistakes. Built first because each part is cheap and measurable alone. Read first: cline checkpoints and loop-detection.ts (Apache-2.0), OpenHands stuck_detector.py (MIT), opencode tool-input-repair.ts and doom_loop (MIT).

No screens (decided 2026-11-10, D83). Settings entries: see ouros-spec.md, Settings tree, Reliability.

## Blocked on

- NEWFEATURES.html keep/change/drop on these six; the four deep-dive calls (provider fallback, honest abort, fresh reviewer, pinned defaults).

## Acceptance criteria

As built 2026-11-15: `core/src/done-proof.ts` (done means proven), `core/src/loop-alarm.ts` and `core/src/reliability.ts` (loop alarm, budget), Settings keys in the workbench. Rewind is refused in code ("rewind is not built yet").

- [ ] M8-13a. A failing test sends the agent back with the output.
  Status: PARTIAL. A failed project check is stored with its exit code and output tail and asks for review. Nothing sends the output back to the agent.
  Verify (passes now): `cd core; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="proveDone failed check" test/m8-rel-wiring.test.ts`.
  Verify (to write): `core/test/m8-rel-wiring.test.ts` test "a failed check queues its output tail as a notice to the session".
- [ ] M8-13b. An edit to a protected test changes nothing; the judge runs from a host-held copy.
  Status: NOT STARTED.
  Verify: to write, `core/test/m8-13-judge.test.ts` test "an agent edit to a protected test leaves the host-held copy the judge runs".
- [ ] M8-13c. A retry rewinds files first, then starts from a clean context with a short summary.
  Status: NOT STARTED. `loop.choose` refuses rewind.
  Verify: to write, `core/test/m8-13-retry.test.ts` test "a retry restores the checkpoint files before the new context starts".
- [x] M8-13d. A run with no acceptance check ends as "needs your review"; a missing test runner is not a pass.
  Status: DONE. A missing runner exits non-zero, so the check fails and asks for review.
  Verify: `cd core; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="proveDone with no command|proveDone failed check" test/m8-rel-wiring.test.ts` (2 tests, pass).
- [ ] M8-13e. Every nudge is logged; a faked provider outage cools down, probes, and asks before any fallback.
  Status: PARTIAL. Loop nudges are Needs-you rows and false alarms persist. Provider retries are counted (M8-23a). There is no cool-down, probe or ask-before-fallback.
  Verify (passes now): `cd core; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="false alarms persist" test/m8-rel-wiring.test.ts`.
  Verify (to write): `core/test/m8-13-outage.test.ts` test "a faked 529 outage cools down, probes, and asks before any fallback engine".
- [ ] M8-13f. Injected faults (timeout, malformed call, loop, crash mid-run) each end in the loop meant for them.
  Status: NOT STARTED.
  Verify: to write, `core/test/m8-13-faults.test.ts` test "each injected fault ends in its own loop".
- [ ] M8-13g. An agent write to a file another tool executes (hooks, .vscode/tasks.json, MCP configs) stays inactive until approved.
  Status: NOT STARTED.
  Verify: to write, `core/test/m8-13-exec-files.test.ts` test "an agent write to .vscode/tasks.json is held until approved".
- [x] M8-13h. Done means proven: a run ends as Done, Checks passed or Needs your review; Done is bound to revision, command, environment and the acceptance check, and cleared by any later edit. The toggle and the acceptance command are in Settings > Reliability > Finishing.
  Status: DONE. `done_proof` stores revision, tree, command, environment and acceptance.
  Verify: `cd core; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="proveDone|latest failed check|passing project check" test/m8-rel-wiring.test.ts` (all pass), and `cd workbench; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="five reliability keys|setCheck" test/m8-rel-settings.test.ts`.
- [ ] M8-13i. Rewind preview and redo (a sheet from Undo, not a screen): each file listed as reverted, skipped or unknown; stops on files changed since the checkpoint; redo until the next message.
  Status: NOT STARTED. Same work as M8-F2.
  Verify: to write, `core/test/m8-13-rewind.test.ts` test "rewind preview lists each file as reverted, skipped or unknown and stops on a file changed since the checkpoint".
- [ ] M8-13j. Repair ladder: tries 1 to 3, each after a rewind; the last may use a stronger model; a wanted test change goes to its own review. Settings > Reliability > Repair.
  Status: NOT STARTED. Needs rewind (13c).
  Verify: to write, `core/test/m8-13-repair.test.ts` test "three tries each start after a rewind and a test change goes to its own review".
- [ ] M8-13k. Progress-aware loop alarm: nudge at 3 identical calls with no new output, stop at 5; declared polling exempt; false alarms counted. The thresholds are in Settings > Reliability > Watching.
  Status: PARTIAL. Nudge at 3, stop at 5, configurable thresholds and false-alarm counts are built and tested. Declared polling is not exempt.
  Verify (passes now): `cd core; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="transcript pairing nudges at three|false alarms persist|configured nudge four" test/m8-rel-wiring.test.ts` (3 tests).
  Verify (to write): `core/test/m8-rel-wiring.test.ts` test "a declared polling call never counts toward the alarm".
- [ ] M8-13l. Your rules as checks: each rule is listed in Settings > Reliability > Your rules with what enforces it or that it is only read, and a caught count.
  Status: NOT STARTED.
  Verify: to write, `workbench/test/m8-13-rules.test.ts` test "Your rules lists each rule with its enforcer or only read, and a caught count".
- [ ] M8-13m. Long runs that survive: runs keep going when Ouros closes; reattach; never re-run an unsafe tool call without asking.
  Status: PARTIAL. The core runs detached and a terminal reattaches from a fresh snapshot. Nothing checks that an unsafe tool call is not re-run.
  Verify (passes now): `cd core; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="reattaches from a fresh snapshot" test/terminal.test.ts`.
  Verify (to write): `core/test/m8-13-resume.test.ts` test "after a core restart an unfinished deploy call waits for a yes".

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
