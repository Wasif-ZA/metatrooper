# M4-6 OSC notification probe and signal

Child of Milestone 4 in `spec.md` (Milestones and child issues). Decisions M4-D1 to M4-D12 and the
verified current state are there; this file is what to build.

## What to build
- `tests/windows/m4-osc-probe.ts`: for each of claude, codex and agy, opens a node-pty terminal in a temp
  git repo with the engine's `ask` approval profile, sends the prompt "create a file named probe.txt
  containing ok", waits up to 120 s, and records every OSC 9, 99 and 777 sequence seen in the raw output
  (regex `\x1b\](9|99|777);[^\x07\x1b]*(\x07|\x1b\\)`). An engine that will not start is recorded as
  `not run: <reason>`. Results go into this section.
- For each engine that emitted one: `core/src/terminal/index.ts` registers `head.parser.registerOscHandler`
  for that code, which calls a new hook `onNotify(id, code)`. `events.ts` appends `term.notify`
  `{"code": 9|99|777}` and maps it exactly like `term.bell` (same `terminal.bell_silent_ms` rule).
- If no engine emits any code, no terminal code changes and the child closes with the probe results.

## Probe results, 2026-10-08T23:26+11:00

`node tests/windows/m4-osc-probe.ts` on Windows, `ask` profile, prompt "create a file named probe.txt containing ok":

| Engine | OSC 9 / 99 / 777 seen in 120 s |
|---|---|
| claude | none |
| codex | none |
| agy | none |

No engine emitted a code, so no terminal code changes (bullet 3 above) and `core/test/terminal-osc.test.ts` is
not kept. The probe does not check that each engine reached its approval prompt before the 120 s ran out.

## Acceptance criteria

- M4-10. The probe results for all three engines are in M4-6. If any emitted, a fake engine that writes
  `\x1b]9;hello\x07` turns its tile `waiting_for_you` after `bell_silent_ms`.

## Tests

| Criterion | Test | Kind |
|---|---|---|
| M4-10 | `tests/windows/m4-osc-probe.ts` (manual, real engines) and `core/test/terminal-osc.test.ts` (fake engine) | manual and unit |

Tests by Codex. A test that needs a real external tool skips with a printed reason when it is absent.
