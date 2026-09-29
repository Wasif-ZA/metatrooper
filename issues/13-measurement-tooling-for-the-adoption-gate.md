# Measurement tooling for the adoption gate

Child #13 of the Agent Harness epic. Milestone 1. Effort: about 0.5 Claude Code days.

Depends on: child #5 to child #11.

## What

Measurement tooling for the adoption gate

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: spec.md § Adoption gate.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] A-01. At least 70% of non-ACU Claude sessions in the window have their `sessionId` in `session.native_id`.
- A-02. Status asks per 100 non-ACU prompts fall below 1. Baseline: 24 / 496 x 100 = 4.8. A status ask is a prompt matching `what are you doing|how long|\beta\b|/btw eta|status\?` (case-insensitive).
- A-03. Smoke-test engine runs fall below 3% of engine runs. Baseline: 26 / 183 = 14.2%. An engine run is one Codex session file under `~/.codex/sessions/` or one Gemini conversation under `~/.gemini/antigravity-cli/conversations/` started in the window, excluding ACU cwds. It is a smoke test when its first user message is under 80 characters and matches `reply (ready|ok)|name the model|which model|echo|ping|say ok|are you (there|working)` (case-insensitive). The harness's own `engine_check` rows are not engine runs.
- A-04. Pasted screenshots per 100 non-ACU prompts fall below 0.5. Baseline: 12 / 496 x 100 = 2.4. Counted as prompts in `~/.claude/history.jsonl` in the window whose `display` contains `[Image #`, excluding ACU sessions (same rule as the baseline). #13 re-runs the 2026-09-29 baseline scripts unchanged so both numbers are measured the same way.
- A-05. Callrouter reports at least 20% saved across shell and Read tokens in the window.
- [ ] A-02. Status asks per 100 non-ACU prompts fall below 1. Baseline: 24 / 496 x 100 = 4.8. A status ask is a prompt matching `what are you doing|how long|\beta\b|/btw eta|status\?` (case-insensitive).
- A-03. Smoke-test engine runs fall below 3% of engine runs. Baseline: 26 / 183 = 14.2%. An engine run is one Codex session file under `~/.codex/sessions/` or one Gemini conversation under `~/.gemini/antigravity-cli/conversations/` started in the window, excluding ACU cwds. It is a smoke test when its first user message is under 80 characters and matches `reply (ready|ok)|name the model|which model|echo|ping|say ok|are you (there|working)` (case-insensitive). The harness's own `engine_check` rows are not engine runs.
- A-04. Pasted screenshots per 100 non-ACU prompts fall below 0.5. Baseline: 12 / 496 x 100 = 2.4. Counted as prompts in `~/.claude/history.jsonl` in the window whose `display` contains `[Image #`, excluding ACU sessions (same rule as the baseline). #13 re-runs the 2026-09-29 baseline scripts unchanged so both numbers are measured the same way.
- A-05. Callrouter reports at least 20% saved across shell and Read tokens in the window.
- [ ] A-03. Smoke-test engine runs fall below 3% of engine runs. Baseline: 26 / 183 = 14.2%. An engine run is one Codex session file under `~/.codex/sessions/` or one Gemini conversation under `~/.gemini/antigravity-cli/conversations/` started in the window, excluding ACU cwds. It is a smoke test when its first user message is under 80 characters and matches `reply (ready|ok)|name the model|which model|echo|ping|say ok|are you (there|working)` (case-insensitive). The harness's own `engine_check` rows are not engine runs.
- A-04. Pasted screenshots per 100 non-ACU prompts fall below 0.5. Baseline: 12 / 496 x 100 = 2.4. Counted as prompts in `~/.claude/history.jsonl` in the window whose `display` contains `[Image #`, excluding ACU sessions (same rule as the baseline). #13 re-runs the 2026-09-29 baseline scripts unchanged so both numbers are measured the same way.
- A-05. Callrouter reports at least 20% saved across shell and Read tokens in the window.
- [ ] A-04. Pasted screenshots per 100 non-ACU prompts fall below 0.5. Baseline: 12 / 496 x 100 = 2.4. Counted as prompts in `~/.claude/history.jsonl` in the window whose `display` contains `[Image #`, excluding ACU sessions (same rule as the baseline). #13 re-runs the 2026-09-29 baseline scripts unchanged so both numbers are measured the same way.
- A-05. Callrouter reports at least 20% saved across shell and Read tokens in the window.
- [ ] A-05. Callrouter reports at least 20% saved across shell and Read tokens in the window.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
