# `security` plugin and `security-review-and-upgrade`

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

Part of the MetaTrooper epic. Milestone 2. Effort: about 1.5 Claude Code days.

Depends on: child #18, child #25.

## What

`security` plugin and `security-review-and-upgrade`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Background. The run folds to the 36px wall bar with no live extra. The round 1 red test and its fix are ink, not
orange.

- Layouts: pr-first (upgrade PR), triage (ledger), triage (findings), before-after (posture), run-log (fix loop).
  Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens when `approve-upgrade` waits, a high reachable finding is not closed by the plan, the check and fix loop
  pauses at max, or a licence conflicts.
- Pick, first match: a failure or the loop at max to run-log; a licence conflict to triage (ledger); a high
  reachable finding to triage (findings); `approve-upgrade` to pr-first. Opened by hand: before-after once handed
  back, run-log while a step runs.
- Steps (two-engine decision, 2026-10-04): `inventory`, `notes`, `plan`, `bump`, `check` and `fix` loop (max 2),
  `licences`, `approve-upgrade` (gate, approve). The hand-back list is the end-of-run tray, not a step.

## Acceptance criteria

- [ ] M2-01. Each milestone-2 built-in runs end to end on its fixture and stops at every gate before a publish step.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.

## Helper tools (M4-8)

| Helper | Repo | Licence | Risk | Egress | Step it helps |
|---|---|---|---|---|---|
| osv-scanner | google/osv-scanner | Apache-2.0 | OK | package names and versions go to the OSV API; `--offline` with a downloaded database avoids it | inventory |
| trivy | aquasecurity/trivy | Apache-2.0 | OK | not checked | inventory and licences |
| semgrep | semgrep/semgrep | LGPL-2.1 | caution: LGPL; fine as an external CLI, never bundled | not checked | notes |
| gitleaks | gitleaks/gitleaks | MIT | OK | none (local scan) | check |

Helpers are optional. Each pipeline runs without them. They are listed in `pipelines/assists/registry.json` once the pipeline is built (registry format in `issues/m4-09-helper-tools.md`).

## Ideas (M4-8)

### Requirements

- Licence allowlist as a code step: `osv-scanner --licenses="MIT,Apache-2.0"` against the project's allowed SPDX list; only conflicts reach the ledger (google/osv-scanner).

### Notes

- Reachable first in the triage queue: sort findings by reachable, then severity; unreachable ones collapse (google/osv-scanner, semgrep/semgrep). Medium, S.
- Guided remediation inside the worktree only: `plan` asks `osv-scanner fix` for the upgrade set and `bump` applies it, never in the main checkout (google/osv-scanner). Medium, M.
- Offline database for repeat runs: cache it under `~/.metatrooper/` so the `check` loop does not re-query the API (google/osv-scanner). Low, S.

## Added requirement (M4-8)

The `check` step reuses M4-4's secret-scan function (see `issues/m4-04-secret-scan.md`) instead of adding a second scanner call.

## Repo scan 2026-10-09

Relevant repos, top ideas and hardening for `security-review-and-upgrade`: `ide-layer-research/m5-repo-scan-preview.md`, the section with the same name. Idea bank only; nothing there is built before launch (M5-D11).
