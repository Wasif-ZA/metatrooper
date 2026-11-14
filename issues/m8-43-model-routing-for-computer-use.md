# M8-43: Model defaults for computer use and browser use

Part of Ouros, Milestone 8. Priority: Low. Effort: 2.5 CC days. Depends on: M8-38 row 1.

## Source of truth

- `ouros-spec.md` section "Computer use and browser use (2026-11-02)".
- Research: scratch `ouros-computer-use-2026-11-02/lanes/models/reply.md`.

## Proposed defaults

Prices are per million tokens, input then output, from the vendors' pages on 2026-11-02.

| Job | Model | Runner-up | Evidence |
|---|---|---|---|
| Read a tree and click | Sonnet 5.5 ($2, $10) | GPT-6.1 Sol ($2, $10) | Browser Use Bench v2.1: 72.7 at $1.53 a task. Sol: 79.6 at $1.30 |
| Read pixels | Fable 5 ($10, $50) | Opus 5 | OSWorld-Verified official sheet, dated 2026-08-01: 86.0 and 83.4. 5.1 and 5.5 models are not on it |
| Long unattended desktop task | Opus 5.5 ($4, $20) | Fable 5.1 ($10, $50) | OSWorld 2.0: 81.8 and 80.7, both vendor-reported |
| Cheap browser sweep | GPT-6 Luna ($0.10, $0.50) | DeepSeek V4.1 Flash 1017 | Bench: Luna xhigh 69.0 at 16c, DeepSeek low 74.0 at 12c. DeepSeek scores higher but sends pages to a third-party API |
| Check a step's result | A different family from the actor, Gemini 3.8 Flash ($0.75, $3.75 to 2026-12-31) | Haiku 5.5 | Untested: no benchmark exists for this job |
| Offline | Holo3.1-4B (5.8 GB, community Ollama build) | none proven | Fits 12 GiB; no OSWorld score found. Treat it as finding targets, not planning |

Working: Fable 5.1 scored 72.0 at $5.19 a task, and Sonnet 5.5 scored 72.7 at $1.53. $5.19 / $1.53 = 3.4 times the cost for
no gain on browser tasks. So Fable is not the browser default.

## How far to trust these

- Browser Use Bench is the only per-task cost comparison found. Browser Use sells a harness and its own agent, so it is not neutral, and it runs tree plus screenshot.
- No benchmark tests tree-only input, which is what `metatrooper-desktop` gives. Row 1 is an inference.
- Aggregator "estimates" of OSWorld-Verified for 5.5 models are not measurements and are not used.
- Haiku 5.5 is weak on browsing: 53.4 to 69.5 by effort in the rows read.

## What gets built

| # | Change | Days |
|---|---|---|
| 1 | The table above as editable defaults on the agent launcher, never forced | 0.5 |
| 2 | Run browser-use/benchmark against `metatrooper-browser` on 2 models. The repo reports no licence, so run it, copy nothing. It runs live sites and costs money: price it first with `/eval-plan` | 2 |

## Not built

OSWorld Windows tasks need a VM, and this laptop has no Hyper-V. The M8-38 benchmark covers the desktop tools instead.

## Acceptance criteria

- [ ] M8-43a. A launched computer-use session shows the default model and can be changed in one step.
- [ ] M8-43b. Scores and cost for 2 models on `metatrooper-browser` are recorded here, after a priced pilot.
- [ ] M8-43c. The table is re-checked against the official OSWorld sheet at build time, because it dates from 2026-08-01.

## Rules that bind every child

- No em dashes.
