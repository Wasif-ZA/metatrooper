# `docs-and-release-notes` pipeline

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

Part of the MetaTrooper epic. Milestone 2. Effort: about 1 Claude Code days.

Depends on: child #25.

## What

`docs-and-release-notes`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Background. The run folds to the 36px wall bar with chips for the planned bump and the docs touched; no live
extra.

- Layouts: pr-first (release draft), run-log, before-after (change request), preview-stage (agent checklist),
  artifact-columns (changelog feed). Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens when `approve` waits, a sample still fails after the fix pass, `release` fails, or a breaking PR has no doc
  under `docs/how-to/upgrade-*`.
- Pick, first match: a sample or `release` failure to run-log; a breaking PR with no migration note to pr-first with
  that line on top; `approve` to pr-first; `release` done to artifact-columns. Opened by hand: preview-stage while
  a step runs. before-after is by hand only.
- Steps (two-engine decision, 2026-10-04): `diff`, `map`, `update` (fanout 3, no worktree), `changelog`, `samples`,
  `approve` (gate, approve), `release` (publish, external). The staged docs end in the hand-back tray, not a step.

## Acceptance criteria

- [ ] M2-01. Each milestone-2 built-in runs end to end on its fixture and stops at every gate before a publish step.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.

## Helper tools (M4-8)

| Helper | Repo | Licence | Risk | Egress | Step it helps |
|---|---|---|---|---|---|
| git-cliff | orhun/git-cliff | Apache-2.0 | OK | none (reads local git history) | changelog |
| release-please | googleapis/release-please | Apache-2.0 | OK | not checked | release |
| changesets | changesets/changesets | MIT | OK | none (reads local `.changeset/` files) | changelog |
| vale | vale-cli/vale | MIT | OK | not checked (`vale sync` fetches style packs) | update |

Helpers are optional. Each pipeline runs without them. They are listed in `pipelines/assists/registry.json` once the pipeline is built (registry format in `issues/m4-09-helper-tools.md`).

## Ideas (M4-8)

### Requirements

None.

### Notes

- Respect pending changesets: in a repo with `.changeset/`, run `changeset status --since=<base> --output` first; changed packages without a changeset become hand-back items (changesets/changesets). Medium, S.
- Corrections through an override block: a changelog line edited at the gate is written as a `BEGIN_COMMIT_OVERRIDE` block in the release PR body (googleapis/release-please). Low, S.
- Prose lint only on changed lines: run vale on edited docs and keep alerts on added lines only (vale-cli/vale, reviewdog/reviewdog). Medium, S.
- The one High value row (version bump by rule) is the added requirement below.

## Added requirement (M4-8)

A code step after `map` computes the version bump from commit prefixes: `fix` patch, `feat` minor, `!` or a `BREAKING-CHANGE` footer major, `Release-As: x.x.x` overrides. If `map` lists removed or renamed exports (its output is not specified here), a removed export with no `!` commit is flagged as a breaking change without a breaking commit. The agent writes prose only (googleapis/release-please; High, S).

## Repo scan 2026-10-09

Relevant repos, top ideas and hardening for `docs-and-release-notes`: `ide-layer-research/m5-repo-scan-preview.md`, the section with the same name. Idea bank only; nothing there is built before launch (M5-D11).

Tag: M5 (after 12-01, per M5-D11). Nothing here is built before launch.

Specced 2026-10-09 against `pipelines/docs-and-release-notes.json` and `plugins/github/bin/github.js` on main `a350f46`.

### Ideas

| Id | Idea, from | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| DR-I1 | Group entries by commit type with regex parsers, from orhun/git-cliff and rafinskipg/git-changelog | changelog | A code step `group-prs` (`pipelines/docs-and-release-notes/group.mjs`) before `changelog` reads the `diff` output and sorts each PR into Added, Changed, Fixed, Skipped or `unsorted` by its title prefix (`feat`, `fix`, `refactor`, `perf`, `chore`, `docs`, `ci`, `test`) and its labels, writing `<run_dir>/groups.json`. `changelog` writes from `groups.json` and only judges the PRs left in `unsorted` | On 6 PRs titled `feat: a`, `fix: b`, `chore: c`, `docs: d`, `refactor: e`, `misc f`, `groups.json` puts a in Added, b in Fixed, e in Changed, c and d in Skipped, f in `unsorted` | 0.5 |
| DR-I2 | Entries from merged PR titles and labels, from github-changelog-generator and lerna/lerna-changelog | diff | Already true: `plugins/github/bin/github.js:51-58` (`list-prs` returns the number, title, labels and body of every merged PR) | Covered today | 0 |
| DR-I3 | One file per change so parallel PRs never conflict, from logchange/logchange | changelog | When the repo has a `changes/unreleased/` folder, `group-prs` (DR-I1) reads each `*.yml` there (`type`, `title`, `pr`) as entries ahead of PR titles. After an approved run, `release` moves them to `changes/<version>/`. Without the folder nothing changes | Two yml files and no matching PRs: both lines appear in `release-notes.md`, and after an approved run both files sit under `changes/v1.1.0/` | 0.75 |
| DR-I4 | Release as a draft a reviewer edits before it goes public, from algolia/shipjs | release | `plugin:github/release` gains `draft: true`, which passes `--draft` to `gh release create` (`github.js:63`). The pipeline sets it, so `release` leaves a draft whose URL the run shows, and publishing stays one click on GitHub | With the gh stub, the `release create` call carries `--draft` and the run output names the draft URL | 0.25 |
| DR-I5 | Conformity checks before publish, from semantic-release/semantic-release | approve | A code step `preflight` (`pipelines/docs-and-release-notes/preflight.mjs`) before `approve` fails the run when `changelog.outputs.version` already exists as a release, is not greater than `diff.since_tag`, or does not match the highest group in `groups.json` (a feat means at least minor), or when `release-notes.md` is empty. Each failure is one line in the gate summary | Version equal to the last tag: the run stops at `preflight` with "v1.0.0 already exists" and `release` never runs | 0.5 |

Worked: 0.5 + 0 + 0.75 + 0.25 + 0.5 = 2.0 CC days.

### Hardening

| Id | Idea, from | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| DR-H1 | A shallow clone gives an empty range, from orhun/git-cliff-action | diff | The shallow clone case is already true: `list-prs` reads merged PRs from the GitHub API (`github.js:53`), not local history. The same silent risk exists in another form: with no release and no `since`, `sinceDate` returns a null date (`github.js:44`) and `list-prs` returns the last 200 merged PRs of all time. Change: with a null date and no `since`, `list-prs` fails with "no release found; set since" | Repo with no releases and `since` empty: the step fails with that message instead of listing PRs | 0.2 |
| DR-H2 | Regenerating overwrites hand-written history, from github-changelog-generator (base merge) | changelog | `preflight` (DR-I5) also compares the staged `CHANGELOG.md` with `HEAD`: every line in `HEAD` must still be there in the same order, so the change only adds lines. Otherwise the run fails and names the first missing line | A changelog stub that rewrites an old entry: `preflight` fails and names that line | 0.25 |
| DR-H3 | A breaking change is missed, from qoomon/git-conventional-commits | changelog | `group-prs` (DR-I1) marks a PR breaking when its title has `!` before the colon or its body contains `BREAKING CHANGE`, and sets the lowest allowed bump to major. `preflight` fails when `changelog.outputs.bump` is below that | One PR titled `feat!: drop node 18` with no labels: `groups.json` lists it under `breaking`, and a changelog stub that says minor fails `preflight` | 0.25 |
| DR-H4 | API rate limits stop the run, from lerna/lerna-changelog (response cache) | diff | Already true: one `gh pr list` call per run (`github.js:53`) plus at most two lookups in `sinceDate` (`github.js:37-48`); there are no per-PR calls to rate limit | Covered today | 0 |
| DR-H5 | A tag is cut from a laptop with local changes, from algolia/shipjs | release | The shape differs here: `release` tags `target` on GitHub (`github.js:63`), but `changelog` and `update` only stage their edits and never commit, so the tag can point at a commit without the new changelog section and docs. `preflight` fails while `git status --porcelain` in the project shows staged or changed files, or while local `base_branch` is ahead of `origin/<base_branch>`, and says to commit and push first | Staged `CHANGELOG.md` left uncommitted: `preflight` fails with "commit and push the staged changelog before tagging" | 0.3 |

Worked: 0.2 + 0.25 + 0.25 + 0 + 0.3 = 1.0 CC days.
