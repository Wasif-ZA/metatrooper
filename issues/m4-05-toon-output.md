# M4-5 TOON output for `troop`

Child of Milestone 4 in `spec.md` (Milestones and child issues). Decisions M4-D1 to M4-D12 and the
verified current state are there; this file is what to build.

## What to build
- Dependency: `@toon-format/toon` from `toon-format/toon` (MIT, 25,456 stars, pushed 2026-10-05, gate pass),
  added to `core/package.json`.
- `troop sessions`, `troop engines`, `troop run status` and `troop run wait` accept `--format toon` beside
  `--json`; output is `encode(result)` of the same object `--json` prints. Browser tools are out: their
  results are small objects or text.
- `tests/fixtures/token-replay/payloads/{sessions,engines,run-status}.json`: one real `--json` output of
  each, captured once by Wasif. Per payload: `saving = 1 - bytes(toon) / bytes(json)`. A command's default
  becomes TOON only when its payload's saving is at least 0.15 and `decode(encode(x))` deep-equals `x`; the
  default stays JSON otherwise and `--json` always forces JSON.

## Acceptance criteria

- M4-09. For each recorded payload, `decode(encode(x))` deep-equals `x`; the report prints each saving and
  which defaults flipped.

## Tests

| Criterion | Test | Kind |
|---|---|---|
| M4-09 | `core/test/toon.test.ts` | unit |

Tests by Codex. A test that needs a real external tool skips with a printed reason when it is absent.
