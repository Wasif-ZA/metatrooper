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

Tag: M5 (after 12-01, per M5-D11). Nothing here is built before launch.

Specced 2026-10-09 against `pipelines/security-review-and-upgrade.json` and `plugins/security/bin/security.js` on main `a350f46`.

### Ideas

| Id | Idea, from | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| SR-I1 | Check the package for dependency confusion and typosquats before the bump, from visma-prodsec/confused, ossillate-inc/packj and pyupio/safety | plan | A code step `vet` (`pipelines/security-review-and-upgrade/vet.mjs`) after `plan` checks `plan.outputs.package`: `npm view <name> name time.created --json` must answer, the package must be older than 30 days, and its name must not be one edit away from another name in `deps.json` or in a list of the 1,000 most downloaded npm packages shipped with the plugin. A failed check stops the run before `bump` and gives the reason | A plan naming `expres`: the run stops at `vet` with "expres is one letter away from express" | 0.75 |
| SR-I2 | Baseline old findings and fail only on new ones, from ShiftLeftSecurity/sast-scan, kulkarnirohit123/cra-agent and openqodex | plan | `plan` reads `.troop/security-baseline.json` when present (a list of `{file, rule, line_text}`) and marks each finding `new` or `known` in `security-report.md`. `high_reachable` counts new findings only. After an approved run the gate summary hands back the command that refreshes the baseline. No baseline file means every finding is new, as today | One known high finding in the baseline and no new ones: `high_reachable` is false and the report lists the finding under known | 0.5 |
| SR-I3 | Diff the SBOM before and after the upgrade, from CycloneDX/cyclonedx-python and tern-tools/tern | check | `plugin:security/list-deps` gains `all: true`, which adds every installed package under `node_modules` to the output (reusing `packages()`, `security.js:44`). The pipeline runs it on the project in `inventory` and again on `bump.outputs.worktree` after `check`. A code step `sbom-diff` lists packages added or removed beyond the planned one, writes `sbom-diff.md`, and the gate summary shows the count | A bump that also pulls in an unrelated package: `sbom-diff.md` names it and the gate summary reads "1 unexpected package" | 0.75 |
| SR-I4 | Licence allow and deny lists as a hard check at the gate, from anchore/grant, dennisdoomen/packageguard and aboutcode-org/scancode.io | licences | Strong and weak copyleft are already split (`security.js:6-7`, `:64-65`). Change: `licence-report` reads `.troop/licences.json` (`allow` and `deny` arrays of SPDX ids) when present. A denied licence counts as a conflict; a licence outside a non-empty allow list goes to Review. `approve-upgrade`'s gate summary gains "Licence conflicts: {{steps.licences.outputs.conflicts}}" so the gate shows them instead of only linking the report | `deny: ["MIT"]` and one MIT package: `licence_conflict` is true and the gate summary names the package | 0.4 |
| SR-I5 | Dry run first and pin exact versions, from pypa/pip-audit and OWASP/cve-lite-cli | bump | `bump` first runs `npm install <pkg>@<version> --dry-run` and writes the planned changes to `<run_dir>/dry-run.txt`, then installs with `--save-exact`. A code check after `bump` fails when the package's entry in `package.json` is not an exact version | `dry-run.txt` exists and `package.json` holds `"lodash": "4.17.21"`, not `"^4.17.21"` | 0.4 |

Worked: 0.75 + 0.5 + 0.75 + 0.4 + 0.4 = 2.8 CC days.

### Hardening

| Id | Idea, from | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| SR-H1 | Transitive dependencies and other lockfile formats get missed, from murphysecurity/murphysec, google/osv-scalibr and nyudenkov/pysentry | inventory | `list-deps` reads only the direct entries of `package.json`, and only npm (`security.js:13-33`). Change: `all: true` (SR-I3) brings in transitive packages. When the project has `poetry.lock`, `uv.lock`, `Pipfile.lock`, `Cargo.lock`, `pnpm-lock.yaml` or `yarn.lock` beside `package.json`, `deps.json` lists them under `not_scanned` and the gate summary shows them, so the plan is never read as complete when it is not | `package.json` plus `uv.lock`: `deps.json` has `not_scanned: ["uv.lock"]` and the gate summary shows it | 0.5 |
| SR-H2 | Findings are false positives or unreachable, from ohaswin/pyscan, openqodex and lambdasec/frame | plan | `plan` already marks each finding reachable or not (pipeline prompt). Change: a finding counts as reachable only when the report gives a call path of `file:line` steps from an entry point. `high_reachable` ignores findings without one, and the report lists them under "not shown reachable" | A stub report with one high finding and no call path: `high_reachable` is false | 0.3 |
| SR-H3 | A patch passes tests but the vulnerability is still there, from lambdasec/frame, google/mantis and shivasurya/code-pathfinder | check | After `check` passes, a code step `rescan` runs `npm audit --json` in `bump.outputs.worktree` and compares the advisories with the ones `plan` says the upgrade closes (a `closes` list in `security-report.md` front matter). The gate summary reads "closed N of M" and names any still open | A bump to a version that still has the advisory: the gate summary reads "closed 0 of 1" | 0.5 |
| SR-H4 | The agent pulls in a hallucinated package or loops forever, from raye-deng/open-code-review, Armur-Ai/vibescan and xeloxa/temodar-agent | bump, fix | The loop cap is already true: `check` and `fix` loop at most twice (`fix.loop.max: 2` in `pipelines/security-review-and-upgrade.json`). Change: `sbom-diff` (SR-I3) runs `npm view <name> version` for each newly added name and fails the run on any name the registry does not know | A worktree whose `package.json` gains `left-padd-xyz`: the run fails at `sbom-diff` naming it | 0.25 |
| SR-H5 (moved to the launch set, M5-17) | A scanner fails on a broken install and the run silently skips it, from Feysh-Group/corax-community, Orange-Cyberdefense/grepmarx and dependency-check/DependencyCheck | licences | `licence-report` writes "Packages: 0" with no conflicts when `node_modules` is missing (`packages()` returns empty, `security.js:45`), which reads as clean. Change: when `package.json` lists dependencies and `packages()` finds none, `licence-report` fails with "node_modules missing in <path>; install before the licence check" | A worktree with dependencies and no `node_modules`: `licences` fails with that message instead of writing an empty report | 0.25 |

Worked: 0.5 + 0.3 + 0.5 + 0.25 + 0.25 = 1.8 CC days.
