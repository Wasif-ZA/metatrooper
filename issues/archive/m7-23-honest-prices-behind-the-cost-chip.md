# M7-23: Honest prices behind the cost chip

Part of the MetaTrooper desk epic (becoming Ouros), Milestone 7. Priority: Medium. Effort: not sized. Depends on: M6-20.
Status: open.

## Source of truth

- core/prices.json (gpt-* placeholder rate)
- core/src/meter.ts:185 (agy logs no model id)
- ~/.cache/claude-scratch/metatrooper-bugs-2026-10-07/report.html Limits left

## What is open

- Codex cost uses a placeholder rate (verified in prices.json) and agy shows tokens but no dollars; the chip and the planned usage page (M8-24) present both as real.
- Also open from the same report: Resume remembers a replacement session only until the core restarts; agy's global toolPermission is still written once.

## Acceptance criteria

- [x] M7-23a. Every price carries a source URL and date, or the chip says "estimated" for a fallback rate. (2026-11-24, B4 on a8a3b642 (own npm ci): core/test/m7-23-honest-prices.test.ts M7-23a and workbench/test/m6-20-cost-chip.test.ts 'M7-23 an estimated usage row makes the session chip show ~$ and est.')
- [x] M7-23b. An unpriced engine shows tokens with "no price", never $0. (2026-11-24, B4 on a8a3b642: core/test/m7-23-honest-prices.test.ts 5/5, M7-23b agy unpriced, chip says no price)
- [x] M7-23c. A test feeds an unknown gpt model and asserts the estimated flag. (2026-11-24, B4 on a8a3b642: core/test/m7-23-honest-prices.test.ts 5/5, M7-23c)
- [x] M7-23d. M8-24 reuses the same flag. (2026-11-24, B4 on a8a3b642: core/test/m7-23d-usage-usd.test.ts 3/3)

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for any fix Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.

Status 2026-11-24: done, every box ticked; each box names its test. Run by B4 on a8a3b642 with its own npm ci; full suite green on eca8743a (M).
