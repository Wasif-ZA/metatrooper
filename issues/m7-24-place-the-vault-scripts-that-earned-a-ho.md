# M7-24: Place the vault scripts that earned a home

Part of the MetaTrooper desk epic (becoming Ouros), Milestone 7. Priority: Low. Effort: not sized. Depends on: M7-22, M8-14.
Status: open; nothing ported.

## Source of truth

- ~/.cache/claude-scratch/metatrooper-vault-port-2026-10-09/placement.html
- memory vault-to-metatrooper-private-first

## What is open

- About 15 vault scripts and skills were marked to move in: page-check.py into pane.capture, suite-diff, mutate.py, rep.py, local-work, the spec-gate and tests-brief skills.
- Most were mapped to pipeline steps that left with the split; only `troop owners` exists.

## Blocked on

- The pipeline homes (M7-22) and the M8-14 manifest format.

## Acceptance criteria

- [ ] M7-24a. Each row is re-sorted into desk core, Ouros plugin, pipeline-products repo, or stays in the vault.
- [ ] M7-24b. Every moved file passes the skills-export.sh sanitising pass and holds nothing from ACU.
- [ ] M7-24c. The first moved item ships with a test.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for any fix Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
