# M4-10 Ideas mined from the helper repos, built pipelines

Child of Milestone 4 in `spec.md` (Milestones and child issues). Decisions M4-D1 to M4-D12 and the
verified current state are there; this file is what to build.

## What to build
Source: `ideas-coding.md` (51 ideas, 37 repos read). High value, small, for pipelines that exist.

| Id | Idea, from | Change |
|---|---|---|
| I1 | Changed-lines filter, reviewdog `filter-mode` | `bucket.mjs` reads `review.diff` (path from `ctx.steps.diff.outputs.diff_file`) and builds, per file, the new-side line ranges of each `@@ -a,b +c,d @@` hunk. Before matching, a finding is `outside` when its file has no hunk, or its `[line_start - 3, line_end + 3]` overlaps no hunk range of its file. Outside findings skip matching and go to a fifth key `outside_change` in `review-buckets.json` (array of `{codex}` or `{gemini}` like the single-engine buckets); `bucket.mjs`'s return gains `outside_change: <count>`. Readers: `review.js` `normalise` keeps building `items` from the four existing buckets only (so `disagree`, `critical`, `files`, `rules.js:10-11` and every layout are unchanged) and adds `outside: [items]`; `app.js:213` `names` and `review.js:77` `LABEL` gain `outside_change: 'Outside the change'`; the run screen header shows "N findings outside the change", which expands to a plain list. An older `review-buckets.json` without the key reads as zero |
| I2 | Skip format-only files, difftastic `--check-only --exit-code` | When `difft --version` succeeds, `diff.mjs` runs `difft --check-only --exit-code <old> <new>` per changed file (old from `git show <range>:<file>`, new from the working tree; 10 s each). Exit 0 means no syntax change: the file's section is removed from `review.diff` and listed in `format-only.txt`, shown as "format only, not reviewed" on the run screen. Any other exit, a timeout, or a new or deleted file keeps the file. Without difftastic nothing changes |
| I3 | Secret scan before the external send, gitleaks `stdin` | The `scan` step in M4-4 |
| I4 | Test baseline before build, superpowers `using-git-worktrees` | A new optional agent-step field `baseline_tests: true`. In `placeIndex`, right after the worktree is created (and after I8's `npm ci`), the runner runs the `repo` plugin's `run-tests` action in that worktree, 600 s timeout, and writes `<run_dir>/<step>-<idx>.baseline.json` (`{passed, exit_code, failing}`). A failing baseline never fails the step; a timeout writes `{"failing": "unknown"}`. `spec-to-pr` sets it on `build`. `plugin:repo/run-tests` gains a `failing` output: an array of test names parsed from node:test (`not ok <n> - <name>`), vitest and jest (`FAIL`/`✕` lines in their default reporters), pytest (`FAILED <nodeid>`), each trimmed; any other runner gives `"unknown"`. A new code step `compare-tests` (`pipelines/spec-to-pr/compare-tests.mjs`) after `verify` outputs `new_failures` and `old_failures` (set difference and intersection by exact name) or `unknown` when either side is `unknown`; the `approve-pr` `gate_summary` reads "<n> new failures (<m> old)" or "new failures: unknown (test output not parsed)" |
| I5 | Spec lint before the gate, OpenSpec `docs/reviewing-changes.md` | A code step `spec-lint` (`pipelines/spec-to-pr/spec-lint.mjs`) between `spec` and `approve-spec`. It reads `<run_dir>/spec.md` and flags: the "acceptance checks" section is missing or empty; a bullet under "user-visible behaviour" shares no word of 5+ letters with any acceptance check; the spec contains any of the words "also", "additionally", "bonus", "nice to have" in "goal". Flags go into the gate summary as lines. No model call; it never blocks |
| I6 | Smaller snapshots, agent-browser `snapshot -i` and `diff snapshot` | `snapshot` gains `interactive?: bool` (keep only nodes that carry a `[ref=...]` plus their ancestors' names) and `since_last?: bool` (keep only lines not present in this session's previous snapshot of the same pane; the previous text is held in memory per pane and session, cleared on navigate). Changed in `core/src/hook/browser-mcp.ts` schema, `workbench/src/browser/panes.ts`, and `contracts/browser-tools.md`. The e2e-browser-qa `qa` prompt asks for `interactive: true` first |
| I8 | Worktree dependencies, parallel-code and vibe-kanban | Per M4-D10, in `placeIndex` after `git worktree add`: if `package-lock.json` exists at the worktree root and `node_modules` does not, run `npm ci --prefer-offline --no-audit --no-fund`, 600 s timeout; failure fails the step with the last 20 lines of npm output. A cache miss downloads from the registry. Setting `worktree.npm_ci` (default true) turns it off |

Kept for later (ideas-coding.md): odiff early stop (website-build `critique` has no loop today), auto-resume
when a usage cap resets (muxa), a spec-kit converge loop, Playwright test agents, scoped re-review, an
osv-scanner licence allowlist step.

## Acceptance criteria

- M4-19. A finding 20 lines from every hunk lands in `outside_change`, and the run stays on its bar.
- M4-21. On a fixture with 2 failing tests before the change, the `approve-pr` summary reads
  "0 new failures (2 old)".
- M4-22. A planted spec with an empty "acceptance checks" section shows that flag in the `approve-spec` summary.
- M4-23. `snapshot` with `interactive: true` on the e2e fixture page returns fewer lines than without, and
  `since_last: true` right after an unchanged snapshot returns no node lines.
- M4-24. In website-build on the fixture, `build` starts in a fresh worktree whose `node_modules` is a real
  folder created by `npm ci`, and `npm ls --all --json` in the main checkout prints the same output before
  and after the run.
- M4-25. With difftastic installed, a fixture diff that only re-indents one file lists it in
  `format-only.txt` and leaves it out of `review.diff`.

## Tests

| Criterion | Test | Kind |
|---|---|---|
| M4-06, M4-25 | `core/test/two-engine-review.test.ts` new cases | integration |
| M4-19 | `core/test/bucket.test.ts` | unit |
| M4-21, M4-22 | `core/test/pipelines-m2.test.ts` new cases | integration |
| M4-23 | `workbench/test/browser-fanout.test.ts` new case, opt-in `METATROOPER_BROWSER_E2E=1` | Electron |
| M4-24 | `core/test/worktree-npm.test.ts` | integration |

Tests by Codex. A test that needs a real external tool skips with a printed reason when it is absent.
