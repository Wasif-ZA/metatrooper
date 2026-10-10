# Hardening review: two-engine-review and spec-build-review-handback

Read-only pass, 2026-10-09. Nothing in the repo was edited. Items marked "run" were reproduced by importing
`pipelines/two-engine-review/bucket.mjs` or running `git diff` in a temp repo; items marked "read" come from reading
the code only. Line numbers are in the file named. `runner.ts` is `core/src/pipelines/runner.ts`.

Already built, not repeated here: I1 changed-lines filter, I2 format-only skip (difftastic), I3 secret scan (as M4-4),
I4 baseline tests (spec-to-pr only), I5 spec lint (spec-to-pr only), I8 worktree `npm ci`. Known open and not repeated:
review-bar "auto-opens once" timeout (fails on main too), Gemini safety-filter empties on sandbox files.

Costs are in CC days (Codex writes the tests, per the test-writing rule; same practice here).

---

## Pipeline 1: two-engine-review

### 1. Repos (42 relevant of 50; dropped as off-topic: latex-arxiv-SKILL, deepdive, bottleneck, atelier, academic-writing-agents, ai-prd-workflow, AlterLab-Academic-Skills, harness-craft)

| repo | stars | licence | idea taken | step it improves | verdict |
|---|---|---|---|---|---|
| alibaba/open-code-review | 44706 | apache-2.0 | Check each reported line against the real code; drop lockfiles and assets before the LLM sees them | bucket, diff | KEEP (T1, T7) |
| tirth8205/code-review-graph | 31994 | mit | Tree-sitter map of the changed functions as review context | diff | NOTE (M4-3 owns it) |
| NVIDIA/SkillSpector | 19737 | apache-2.0 | Ingest caps: size limits before anything is read | diff | KEEP (T7) |
| darrenhinde/OpenAgentsControl | 4894 | mit | Review against the project's own patterns, not only bugs | codex-review, gemini-review prompt | NOTE |
| pedrohcgs/claude-code-my-workflow | 1653 | mit | Agents may not edit hook and config files | review steps | NOTE (approval is already `edits`) |
| tomasz-tomczyk/crit | 1189 | mit | Round-to-round diff of findings; comments pinned to lines | bucket | KEEP (T8 dedupe key; H2 in pipeline 2) |
| villesau/ai-codereviewer | 1043 | mit | Post findings as inline PR comments | bucket | NOTE (reviewdog assist exists) |
| DevoxxGenieIDEAPlugin | 684 | mit | Gitleaks before the send | diff | NOTE (built as I3) |
| sturdy-dev/codereview.gpt | 607 | mit | Run the review several times | review steps | NOTE (cost x2) |
| chorus-codes/chorus | 534 | apache-2.0 | Flag cross-model disagreement for a human | bucket | NOTE (exists; T2 fixes its edge) |
| ZaxbyHub/opencode-swarm | 493 | mit | Path validation so a finding cannot point outside the intended files | bucket | KEEP (T1) |
| josstei/maestro-orchestrate | 465 | apache-2.0 | Express path: skip heavy work for trivial changes | diff | KEEP (T6) |
| spencermarx/open-code-review | 371 | apache-2.0 | Debate round between reviewers | bucket | NOTE |
| cirolini/genai-code-review | 371 | mit | Comment budget ranked by severity and confidence | bucket | NOTE |
| automagik-dev/genie | 346 | mit | Reviewer must differ from the author | steps | NOTE (already true) |
| athola/claude-night-market | 341 | mit | TDD gate before the diff step | diff | NOTE |
| cyberchitta/llm-context.py | 308 | apache-2.0 | Rule files choose which files and excerpts to send | diff | NOTE |
| TheMorpheus407/RepoLens | 298 | apache-2.0 | Specialised lenses (security, perf) instead of one generic prompt | prompts | NOTE |
| truongnh1992/gemini-ai-code-reviewer | 254 | mit | Post feedback directly on the PR | bucket | NOTE |
| Hoylon/peerbridge-mcp | 241 | apache-2.0 | Writer leases so one process edits a file | diff (concurrent runs) | NOTE |
| Miguok/fable-harness | 204 | mit | Skeptic, red-team, simplifier sub-reviewers | review steps | NOTE |
| syabro/rejudge | 165 | mit | Three-model consensus | bucket | NOTE |
| krishagarwal314/CodeJury | 146 | mit | Jury of two or more models | bucket | NOTE |
| closedloop-ai/claude-plugins | 122 | apache-2.0 | LLM-as-judge before accepting | bucket | NOTE |
| devarshishimpi/codra | 120 | agpl-3.0 | Model routing with fallback when one provider fails | codex-review, gemini-review | KEEP (T3; idea only, AGPL) |
| PROrunner926/copilot-cache-scout | 115 | none listed | Digest to shrink review context | diff | NOTE |
| usetig/sage | 106 | none listed | Reviewers cross-check each other | bucket | NOTE |
| zclllyybb/OpenGiraffe | 106 | none listed | Multi-reviewer voting | bucket | NOTE |
| MoaKK/AI-Code-Reviewer | 102 | none listed | `parseValidLines`: throw away findings on lines that are not in the diff | bucket | KEEP (T1) |
| Mybono/ai-orchestrator | 100 | other | Role personas per reviewer | prompts | NOTE |
| ZJunCher/mr-agent | 99 | agpl-3.0 | Identify, evidence, review, decide stages | prompts | NOTE |
| umputun/revmux | 97 | mit | Synthesis pass that merges overlapping findings | bucket | KEEP (T8) |
| yogirk/agent-council | 91 | mit | Stage 2 where reviewers read each other's output | bucket | NOTE |
| Usagi-org/ai-code-review-helper | 90 | apache-2.0 | Structured JSON mapping each issue to exact lines | prompts, bucket | KEEP (T4) |
| hieuphung97/dely | 86 | mit | Different harness per role | steps | NOTE |
| riekelt/multi-agent-review | 86 | none listed | Cheap model first, strong model on discrepancies | steps | NOTE |
| ArafatAhmedMubinOfficial/2M-Code | 84 | other | Different provider for the second review | steps | NOTE |
| majiayu000/harness | 83 | mit | Cross-agent review | steps | NOTE |
| avenoxai/avenoxskills | 81 | mit | Bundle and scan before an external send | diff | NOTE (I3 covers) |
| agent-room-alkl/agent-room | 78 | mit | Tagged machine-readable result blocks | prompts | NOTE |
| 9thLevelSoftware/legion | 78 | none listed | Board of reviewers | steps | NOTE |
| enowdev/enowxcli | 69 | apache-2.0 | Orchestrator role for hand-off | steps | NOTE |
| simion/reviewd | 67 | mit | Enforce a JSON schema on the model's answer | prompts, bucket | KEEP (T4) |

### 2. Hardening items (10, ranked)

**T1. Findings that do not match the diff's spelling go to `outside_change` or match the wrong lines** (run)
- Step: bucket. Code: `bucket.mjs:14-18` (`overlaps`), `:39-42` (`insideChange`), `:45-63` (`bucketFindings`), `:83-89` (`withFindings`).
- Failure: codex returns `{"file":"./src/a.js","line_start":11}` or `src\a.js` (Windows) or an absolute path, or uses `line` instead of `line_start`: run shows all land in `outside_change`, so the real bug is hidden under "Outside the change" and never reaches `both`. Strings are also wrong: `line_start:"5"`, `line_end:"5"` against hunk 10-14 is classed inside, because `"5" + 3` is the string `"53"` (run: goes to `codex_only` instead of `outside_change`).
- Fix: add one `normalise(f)` at the top of `bucketFindings`: strip `./`, turn `\` to `/`, strip the project path prefix, `Number()` both lines, accept `line` as `line_start`, and swap if start > end. Findings that cannot be normalised go to a sixth key `unplaced`.
- Smallest failing test: `bucketFindings` with codex `{file:'./a.js',line:11}` and gemini `{file:'a.js',line_start:11,line_end:11}` against a hunk at 10-14; expect one `both`, today expect zero.
- Effort: 0.4. Source: MoaKK/AI-Code-Reviewer, alibaba/open-code-review, ZaxbyHub/opencode-swarm.

**T2. A split verdict hides agreed findings from the fix loop** (run)
- Step: bucket. Code: `bucket.mjs:48` (`split`), `:59` (`buckets[split ? 'disagree' : 'both']`).
- Failure: codex says approve with a note on `a.js:11`, gemini says reject on `a.js:11`. Both flagged the same line, but the pair lands in `disagree` and `both` is empty (run). `spec-build-review-handback` fixes only `both`, so it fixes nothing, and the real bug survives into the hand-back as "disputed". Verdicts spelled `Approve` or `approved` also bypass the check (`split` compares to the exact string `approve`).
- Fix: a matched pair always goes to `both` and gets `split: true` when verdicts differ; lower-case and trim verdicts, map `approved`/`lgtm` to `approve`. The review screen's disagreement rule reads `split` instead of bucket name (workbench `review.js`, `rules.js`).
- Smallest failing test: codex approve + gemini reject, same finding; expect `both.length === 1`, today `disagree.length === 1`.
- Effort: 0.5 (bucket 0.1, workbench rule and its two tests 0.4). Decision for Wasif: this changes what "disagree" means on screen.
- Source: chorus-codes/chorus (edge of the idea).

**T3. One engine failing or timing out fails the whole run and throws the other engine's work away** (read)
- Step: codex-review, gemini-review. Code: `two-engine-review.json:55,69` (5 min each), `runner.ts:858` returns `{ok:false}`, `finishRow` `:560-572` fails the row, and nothing in `validate.ts` allows a step to fail softly.
- Failure: codex times out at 5 min (big diff, rate limit). Gemini never starts because steps are sequential; `bucket` never runs; the run is `failed` with no `review-buckets.json`. If gemini is the one that fails (the known safety-filter empties), codex's finished review is lost.
- Fix: new step field `optional: true`: a failed optional step is stored as `done` with `{verdict:'failed', error}`. `bucket.mjs` treats that engine's findings as empty, sets `<engine>_verdict: 'failed'`, and the run screen says "only Codex reviewed". Set it on both engine steps.
- Smallest failing test: fake engine that exits without writing; expect the run reaches `bucket` and `codex_verdict` is `failed` while gemini's findings are in `gemini_only`. Today the run is `failed`.
- Effort: 1.0 (runner and validate 0.5, bucket and UI string 0.3, test 0.2). Shared with H9 (pipeline 2).
- Source: devarshishimpi/codra.

**T4. Unparseable engine output reads as "no findings"** (run)
- Step: bucket. Code: `bucket.mjs:6-12` (`asFindings` swallows JSON errors), `:66-81` (`findingsInText`), `:83-89`.
- Failure: engine writes the array in the result body with a bracket inside a string, e.g. `"body":"arr[0"`, or a pretty-printed array under `findings:` in front matter (the parser at `template.ts:131-163` returns `[]`). `findingsInText` counts brackets inside strings, so it returns `null` (run), `findings` becomes `[]`, and a `reject` verdict with zero findings looks like a clean run.
- Fix: make `findingsInText` skip over quoted strings while counting depth; record per engine `parse: 'ok' | 'fallback' | 'failed'`; when verdict is `reject` and zero findings parsed, return `unparsed: true` and show "Codex rejected but no findings could be read, open codex-review.md".
- Smallest failing test: result text `Notes x[ y\n[{"file":"a","body":"arr[0"}]`; expect 1 finding, today `null`.
- Effort: 0.4. Source: simion/reviewd, Usagi-org/ai-code-review-helper.

**T5. Paths with spaces or non-ASCII names break the hunk map** (run, verified with real git output)
- Step: diff and bucket. Code: `diff.mjs:33` (`git diff`), `bucket.mjs:25,27` (`+++ b/(.+)`), `diff.mjs:9` (`diff --git a/(\S+) b/(\S+)`).
- Failure: git writes `+++ b/my file.js<TAB>` for names with spaces, so `file` becomes `my file.js\t` and never equals the engine's `my file.js` (every finding goes outside). For `café.js` git quotes the header as `"b/caf\303\251.js"`; `hunkRanges` returns an empty Map (run), and if that is the only changed file the filter is switched off, otherwise its findings all go outside.
- Fix: call `git -c core.quotepath=off diff --no-ext-diff --no-color`, and trim a trailing tab in the `+++` capture. Keep the `fileSections` regex but fall back to the `+++` path when `\S+` fails.
- Smallest failing test: `hunkRanges('+++ b/my file.js\t\n@@ -1 +1,2 @@\n')` has key `my file.js`; today `my file.js\t`.
- Effort: 0.3. Source: none (found by test).

**T6. An empty diff still launches both engines** (read)
- Step: diff to codex-review. Code: `diff.mjs:36,51` returns `lines: 0`; `two-engine-review.json:44-71` has no condition; `validate.ts:157` only lets gates take `when`.
- Failure: `range` defaults to `HEAD` and the tree is clean (or the fix agent changed nothing, in pipeline 2). Two real sessions start for a zero-line file and burn quota and up to 10 minutes; the engines may invent findings against an empty diff.
- Fix: allow `when` on agent steps (skip as done with no outputs) and add output `empty: true` to `diff.mjs`; engine steps use `when: steps.diff.outputs.empty != "true"`. The `evalUntil` helper (`runner.ts:406`) only knows `==`, so add `!=`. `bucket.mjs` already tolerates missing step outputs.
- Smallest failing test: clean repo, run `two-engine-review` with fake engines; expect zero sessions started. Today two.
- Effort: 0.75 (shared runner change with H3 in pipeline 2). Source: josstei/maestro-orchestrate.

**T7. Huge, binary and generated files go to the engines or crash the diff step** (read)
- Step: diff. Code: `diff.mjs:33` (`maxBuffer 64 MB`), `:21` split of sections.
- Failure: a change that regenerates `package-lock.json` (or adds a 70 MB asset) makes `execFileSync` throw `ENOBUFS` (step fails with a stack, no hint). Below that limit a 20 000-line lockfile and `Binary files differ` stubs go to both engines, which burn the 5 minutes reading them.
- Fix: in the section loop drop sections that are binary (`/^Binary files /m`), lockfiles and `*.min.*`, and cut the diff at a line cap (default 5 000), listing everything left out in `not-reviewed.txt` (same shape as `format-only.txt`). Catch `ENOBUFS` and report "diff larger than 64 MB, narrow `path`".
- Smallest failing test: diff containing a 300 000-line lockfile and one 3-line source change; `review.diff` contains only the source change and `not-reviewed.txt` names the lockfile.
- Effort: 0.6. Source: alibaba/open-code-review, NVIDIA/SkillSpector.

**T8. Duplicate findings from one engine inflate the buckets, and matching is first-come** (run)
- Step: bucket. Code: `bucket.mjs:53` (`findIndex` takes the first unused overlap), `:55-57`.
- Failure: codex reports the same bug twice (`a.js:11` and `a.js:11-12`). The first pairs with gemini; the second becomes `codex_only` (run), so the hand-back lists a "disputed" finding that is a duplicate. Greedy matching can also pair a finding with a farther gemini finding and leave the exact one unmatched.
- Fix: before matching, merge findings within one engine when file is equal and ranges overlap by WIDEN and titles share a word of 5+ letters (keep the higher severity); when matching, choose the overlapping candidate with the smallest start-line distance.
- Smallest failing test: codex two overlapping findings, gemini one; expect `both: 1`, `codex_only: 0`. Today `codex_only: 1`.
- Effort: 0.4. Source: umputun/revmux, tomasz-tomczyk/crit.

**T9. `path` input rewrites the index of the folder it diffs** (read)
- Step: diff. Code: `diff.mjs:32` (`git add --intent-to-add --all`).
- Failure: run standalone with `path` set to a real checkout: every untracked file gets an intent-to-add entry in the user's real index and stays there after the run. In the spec-build pipeline the path is a throwaway worktree, so only the standalone case is exposed. Ignored-by-accident folders (an un-ignored `node_modules`) are staged too.
- Fix: copy the index to a temp file, set `GIT_INDEX_FILE` for the `add -N` and `diff` calls, delete it afterwards. Add `--` after `range` so a branch named like a file is not ambiguous.
- Smallest failing test: after the step, `git diff --cached --name-only` in the folder prints nothing. Today it lists the untracked files.
- Effort: 0.4. Source: none.

**T10. CRLF and non-UTF-8 files turn into noise** (read, autocrlf warning reproduced)
- Step: diff. Code: `diff.mjs:33` (`encoding: 'utf8'`), `:37` write.
- Failure: a file whose line endings flip (autocrlf, editor setting) shows as fully rewritten, so the hunk map covers the whole file and the changed-lines filter does nothing, and both engines review every line. Latin-1 source is decoded to U+FFFD and written back changed, so a finding quotes text that is not in the file. difftastic only rescues this when installed.
- Fix: add `--ignore-cr-at-eol`; read the buffer, write the buffer unchanged (`encoding: 'buffer'`), decode with `latin1` only for the split into sections.
- Smallest failing test: commit LF file, rewrite as CRLF; `review.diff` is empty. Today it is the whole file.
- Effort: 0.3. Source: none.

Total for pipeline 1: 5.05 CC days. Suggested first batch (cheap, high impact): T1, T5, T4, T10, T8 = 1.8 days.

Note for M5-06 (not duplicated here): findings have no stable id, and `proof` needs one. Add `id = sha1(file + title + normalised start)` in `bucket.mjs` after T1 and T8, so `fixes.json` can name findings. Prompt also needs a fixed `severity` enum (`critical|high|medium|low`); the current prompt lets each engine invent words, and `workbench` ranks on them.

---

## Pipeline 2: spec-build-review-handback

### 1. Repos (42 relevant of 50; dropped as off-topic: OpenMontage, marketingskills, ai-website-cloner-template, awesome-agent-skills, Anthropic-Cybersecurity-Skills, frontend-slides, archify, huashu-design, notebooklm-py, K-Dense scientific-agent-skills; cross-listed from pipeline 1 to reach 42: crit, opencode-swarm, maestro-orchestrate)

| repo | stars | licence | idea taken | step it improves | verdict |
|---|---|---|---|---|---|
| obra/superpowers | 296668 | mit | Clean test baseline in a fresh worktree before verify | build, verify, reverify | KEEP (H4; built only for spec-to-pr) |
| affaan-m/ECC | 275545 | mit | Automated verify before human review; distil context | verify | NOTE |
| farion1231/cc-switch | 141648 | mit | Fall back to another provider on outage | build, fix | NOTE |
| JuliusBrussee/caveman | 110632 | apache-2.0 | Terse output; keep code and paths verbatim | handback | NOTE |
| addyosmani/agent-skills | 103495 | mit | Spec before code; interview for requirements | spec | NOTE (I5 built) |
| bytedance/deer-flow | 83560 | mit | Sandboxed build; admission control for provider limits | build, fix | NOTE (sandbox exists) |
| ruvnet/ruflo | 74158 | mit | Failure triage: environment vs logic | reverify, handback | KEEP (H9) |
| ayghri/i-have-adhd | 55900 | mit | Action first, no preamble | handback | NOTE (house style already) |
| hesreallyhim/awesome-claude-code | 55293 | other | Project rules file as context for spec and build | spec, build | NOTE |
| LibreChat-AI/LibreChat | 45429 | mit | Ask, allow, deny on agent writes and commands | build, fix | NOTE (approval levels exist) |
| iOfficeAI/AionUi | 33395 | apache-2.0 | Team of specialised agents | build, fix | NOTE |
| alirezarezvani/claude-skills | 27890 | mit | Named-persona adversarial review | review | NOTE |
| TencentDB-Agent-Memory | 27845 | other | Turn a successful fix into a reusable skill | fix | NOTE |
| OthmanAdi/planning-with-files | 27349 | mit | Hash-attested plan file so spec cannot drift | approve-spec, build | NOTE |
| cloudflare/security-audit-skill | 26691 | mit | Verifier differs from builder; confirm only with a source trace | review, handback | NOTE (M5-06 owns) |
| Donchitos/Claude-Code-Game-Studios | 25951 | mit | Hook scripts run on verify | verify | NOTE |
| mksglu/context-mode | 25814 | other | Session continuity check on the original goal | fix | NOTE |
| KKKKhazix/khazix-skills | 21265 | mit | Three-colour risk grade: auto-fix vs ask | fix | NOTE |
| NVIDIA/SkillSpector | 19737 | apache-2.0 | Size caps before ingest | review | NOTE (T7 covers) |
| MervinPraison/PraisonAI | 9207 | mit | Doom-loop cap: max iterations and budget ceiling | build, fix | KEEP (H9) |
| gemini-cli-extensions/conductor | 3759 | apache-2.0 | Plan artefact with granular tasks | build | NOTE |
| spec-kitty/spec-kitty | 1678 | mit | Work packages with lifecycle lanes | build, fix | NOTE |
| zhu1090093659/spec_driven_develop | 985 | mit | Fall back to local-only mode when tools are missing | build | NOTE |
| shotgun-sh/shotgun | 689 | mit | Re-research when the agent drifts from the plan | fix | NOTE |
| ThibautBaissac/rails_ai_agents | 665 | mit | PreToolUse guards block destructive commands | build, fix | NOTE |
| Grigorij-Dudnik/Clean-Coder-AI | 585 | apache-2.0 | Lint after each file edit | build | NOTE |
| kaanozhan/Frame | 409 | apache-2.0 | Per-fix outcome record: what changed and why | fix, handback | KEEP (H8) |
| loulanyue/spec-kit-zh | 339 | mit | Constitution; brownfield reconcile | spec | NOTE |
| fstandhartinger/ralph-wiggum | 301 | mit | Stuck detection after N attempts; explicit done promise | build, fix | KEEP (H9) |
| KbWen/agentic-os | 206 | mit | Validate claims against a work log; credential scan | handback | KEEP (H1) |
| sudokar/openspec-plus | 205 | mit | Ambiguity reduction in spec | spec | NOTE (I5 built) |
| av/facts | 204 | none listed | Machine-checkable command per fact | verify, handback | KEEP (H1) |
| FrankS-IntelLab/agentic-kaggle-skill | 188 | mit | Detect hidden rerun failures (timeouts, OOM) | reverify | NOTE |
| bar181/aisp-open-core | 177 | other | Symbolic spec notation | spec | NOTE |
| MJ-CJM/fuxi-cli | 127 | apache-2.0 | Constitution to spec transition | spec | NOTE |
| attilaszasz/sdd-pilot | 97 | mit | Clarify step between spec and plan | spec | NOTE |
| sengac/fspec | 97 | mit | Gherkin acceptance for edge cases | spec | NOTE |
| JeiKeiLim/tenet | 95 | none listed | DAG of tasks with multiple critics | build | NOTE |
| kucherenko/gangsta | 85 | mit | Adversarial debate on the plan | spec | NOTE |
| tomasz-tomczyk/crit | 1189 | mit | Round-to-round diff of findings | rereview, handback | KEEP (H2, H5) |
| ZaxbyHub/opencode-swarm | 493 | mit | Scope bypass prevention across files | fix | KEEP (H8) |
| josstei/maestro-orchestrate | 465 | apache-2.0 | Block progression on critical issues; skip heavy steps | fix | KEEP (H3) |

### 2. Hardening items (9, ranked)

**H1. A missing or unreadable review result looks like "no disputes"** (read)
- Step: handback. Code: `handback.mjs:4-12` (`buckets`, `catch {}` at `:10`, `return {}` at `:11`), used at `:24-25`.
- Failure: the `review` child finished but `review-buckets.json` was never written or is corrupt (T3, T4), or the child folder is missing. `buckets()` returns `{}`, `list()` returns nothing, and the hand-back reads "1. Review and commit the work in ...". The user commits unreviewed code believing both engines were clean.
- Fix: when `buckets()` finds no valid file, add a human item "Review results missing for review (or rereview): read <run dir>/review/" and put it first. Same for `codex_verdict` or `gemini_verdict` of `failed` or `unknown` (after T3).
- Smallest failing test: call `run()` with a ctx whose `runDir` has no `review/` folder; expect an item with kind `human` containing "missing". Today the item list has one entry.
- Effort: 0.2. Source: KbWen/agentic-os, av/facts.

**H2. Rereview results are mislabelled and half dropped; no link to the first review** (read)
- Step: handback. Code: `handback.mjs:29` (`list(again, ['both','disagree'])` labelled "still found after the fix").
- Failure: (a) a bug only gemini finds in the rereview (`gemini_only`) is dropped, so it never reaches the hand-back; (b) a new bug the fix introduced is reported as "still found after the fix"; (c) line drift: the fix moved `a.js:10` to `a.js:14`, nothing connects them, so a fixed finding and a new one cannot be told apart; first-review lines in the hand-back also point at pre-fix lines.
- Fix: match each first-review finding to the rereview ones by file, title word overlap and nearest line (reuse T1 normalise, T8 merge). Label three ways: "still found", "new after the fix", "not seen again". List all four rereview buckets. Put the matcher in one shared file so M5-06's proof gate uses it.
- Smallest failing test: first review `both` at `a.js:10 "null deref"`, rereview `both` at `a.js:14 "null deref"` gives "still found"; rereview `gemini_only` at `b.js:3 "typo"` gives "new after the fix". Today the first says "still found" for any title, the second is dropped.
- Effort: 1.0. Source: tomasz-tomczyk/crit. Overlaps M5-06 ("rereview no longer reports a finding overlapping it"); build once.

**H3. The fix agent runs when there is nothing to fix** (read)
- Step: fix. Code: `spec-build-review-handback.json:61-71` (no condition; prompt `:69`), `validate.ts:157` (`when` gate-only).
- Failure: `both` is empty (the engines disagreed, or found nothing, or T2's split verdict). A `worker` agent still starts, reads the file, runs the whole test suite, and then `reverify` and `rereview` run two more full engine sessions. Up to 30 minutes and four sessions for a no-op.
- Fix: a small code step `plan-fix` after `review` that reads the exact buckets file (see H6) and outputs `fix_count`; give `fix`, `reverify` and `rereview` `when: steps.plan-fix.outputs.fix_count != "0"` (needs T6's runner change). Handback says "nothing to fix" instead.
- Smallest failing test: fake engines both approve; expect no `fix` session. Today one starts.
- Effort: 0.5 (runner change shared with T6). Source: josstei/maestro-orchestrate.

**H4. "Tests fail after the fix" cannot tell old failures from new ones** (read)
- Step: build, handback. Code: `spec-build-review-handback.json:32-42` (no `baseline_tests`), `handback.mjs:30`; `spec-to-pr.json:54` and `pipelines/spec-to-pr/compare-tests.mjs` already have the fix.
- Failure: repo already has 2 failing tests. `reverify` reports `passed: false`; the hand-back says "Tests fail after the fix (exit 1)" with no way to know the fix is not to blame, or that the build did not break more. A user who learns to ignore the line also misses a real regression.
- Fix: set `"baseline_tests": true` on `build`, add the existing compare step after `reverify`, and make handback print "N new failures (M old)" from it, as M4-21 does for spec-to-pr. Reuse; no new code except wiring.
- Smallest failing test: fixture with 2 failing tests and a fix that adds none; hand-back has no human "Tests fail" item.
- Effort: 0.4. Source: obra/superpowers.

**H5. Rereview reviews the whole build again, not the fix** (read)
- Step: rereview. Code: `spec-build-review-handback.json:81-89` (only `path` passed, `range` defaults to `HEAD`).
- Failure: the worktree is uncommitted, so `git diff HEAD` is build plus fix. The second review pays for the full change, re-reports every unfixed finding as new noise, and cannot say what the fix changed. A 2 000-line build means a second 2 000-line review for a 10-line fix.
- Fix: after `build` (or `verify`) a code step records a tree snapshot with a temporary `GIT_INDEX_FILE`: `add -A`, `write-tree`, output `after_build_tree`. Pass it as `range` to `rereview`: `git diff <tree>` shows only the fix. Compare M4-10's "scoped re-review", listed there as kept for later and not built.
- Smallest failing test: fix edits one line; `rereview` `review.diff` contains that hunk only. Today it contains the whole build.
- Effort: 0.8. Source: tomasz-tomczyk/crit, tirth8205/code-review-graph (incremental idea).

**H6. The hand-back and the fix prompt read "the one folder" under `review/`** (read)
- Step: fix, handback. Code: `handback.mjs:4-12` (first folder that parses wins), `spec-build-review-handback.json:69` ("the one folder under {{run.dir}}/review/").
- Failure: a retried `review` step starts a new child run (`runner.ts:1008` reuses only a `running`, `paused` or `done` child). Two child folders then exist. `readdirSync` order is oldest first, so a stale but valid older result wins, and the agent is told there is exactly one folder.
- Fix: `bucket.mjs` returns `buckets_abs` (its own `ctx.runDir` joined with the file name). `fix` prompt and `handback.mjs` use `{{steps.review.outputs.buckets_abs}}` and `ctx.steps.review.buckets_abs` (rereview likewise). No directory scanning.
- Smallest failing test: two child folders with different buckets; hand-back lists the newer child's findings. Today it lists the older.
- Effort: 0.3. Source: none. Also helps M5-06 (fixes the same path guess).

**H7. The hand-back hides half of each disagreement and orders by bucket, not severity** (read)
- Step: handback. Code: `handback.mjs:14-18` (`pair.codex || pair.gemini || pair`), `:28`.
- Failure: for a `disagree` pair only codex's title and severity print; gemini's different reading is lost. Items are ordered disagree, codex_only, gemini_only regardless of severity, so a `critical` nit-pick sits above nothing and a `critical` gemini-only finding is item 4 of 9. No body is shown, so the user must open JSON to act.
- Fix: print both titles for pairs ("codex: X / gemini: Y"), sort by severity (critical, high, medium, low, none) then bucket, and add the first 160 characters of the body; end with the path to `review-buckets.json`.
- Smallest failing test: `disagree` pair with titles "A" and "B"; both appear in the item text. Today only "A".
- Effort: 0.4. Source: ayghri/i-have-adhd (action first).

**H8. Nothing checks the fix stayed inside the findings** (read)
- Step: fix. Code: `spec-build-review-handback.json:69` ("Fix only the findings in its both list... Leave every other finding alone"); no code step follows.
- Failure: the prompt is the only guard. A worker that "also tidies" `utils.js` passes `reverify` and reaches the hand-back looking fine; the user is asked to commit a change nobody reviewed, because rereview shows the whole diff (H5) and the extra edits are lost in it.
- Fix: a code step `fix-scope` after `fix`: with H5's tree snapshot, list files changed since build (`git diff --name-only <tree>`), subtract files named in the `both` findings and test files; each remaining file becomes a hand-back human item "fix touched <file>, no finding named it". Informational, never blocks.
- Smallest failing test: fake fix edits an unrelated file; hand-back has a human item naming it.
- Effort: 0.6. Source: ZaxbyHub/opencode-swarm, kaanozhan/Frame. Partly overlaps M5-06's `diff` proof (note, do not build twice).

**H9. A failed step after the build leaves no hand-back at all** (read)
- Step: handback and everything after build. Code: `spec-build-review-handback.json:91-96` (`handback` is the last step), `runner.ts:560-572` (`finishRow` fails the run on the first failed step), agent default timeout `runner.ts:752` (30 min, none set in the pipeline file for `spec`, `build`, `fix`).
- Failure: `build` takes 35 minutes on a large repo and times out, or `rereview` loses an engine (T3). The run ends `failed`; the worktree with all the work stays on disk but nothing says where, what was reviewed, or what to do. Cleanup (`runner.ts:311-326`) removes only clean worktrees, so the user has to hunt for it. Repeated failing attempts are not capped either, so a retry loop can spend the 180-minute budget.
- Fix: step field `always: true` on `handback`: it runs even when an earlier step failed, with ctx marking `failed_step` and its error; handback prints "Stopped at <step>: <error>. Work is in <worktree> on <branch>" plus whatever buckets exist (H1). Set explicit `timeout_minutes` (build 60, fix 30). Cap retries at 2 per step before the run stops.
- Smallest failing test: fake engine fails `rereview`; `handback.md` exists and names `rereview` and the worktree. Today the run ends with no `handback.md`.
- Effort: 1.0 (runner 0.6, handback 0.2, test 0.2). Source: PraisonAI (doom-loop cap), ralph-wiggum (stuck detection), ruvnet/ruflo (failure triage).

Total for pipeline 2: 5.2 CC days. Suggested first batch: H1, H6, H4, H2 = 1.9 days. H9 and T3 share the "soft fail" runner change; do them together.

Note for M5-06 (not duplicated here): it needs H2's matcher, H6's exact bucket path, T1/T8's normalised findings with ids, H4's baseline so "proof" tests are not confused by old failures, and H5's tree snapshot as the `base` for `diff` proof. Build those first and the 3.5-day estimate holds; without them M5-06 re-solves each inline.

# Hardening list: spec-to-pr and e2e-browser-qa

Read-only pass over projects/metatrooper on 2026-10-09. Code reads are against the working tree as it stands. Repo rows come from the local-model README scan and were judged by name and one-line purpose only (the READMEs were not re-read). Treat every repo idea as a lead, not a finding. Items in section 2 of each pipeline are verified against code (file:line). Ideas already built (M4-10 I1 to I8: changed-lines filter, difftastic skip, secret scan, test baseline, spec lint, snapshot interactive/since_last, npm ci) are not proposed again.

Effort is in CC days (one day of Claude Code work including the test).

---------------------------------------------------------------------------

# 1. spec-to-pr

## 1.1 Repos (KEEP/NOTE rows below, 7 dropped as not relevant: 6S191_MIT_DeepLearning, -L- (W3C report), Surviv.io, ai-engineer-roadmap, gen-ai-software-engineering-training, green-software-engineer, suricata (Go agent DSL))

| repo | stars | licence | idea taken | step it improves | verdict |
|---|---|---|---|---|---|
| mraza007/baton | 24 | mit | stale-branch sync: handle base moving while the agent works | build, open-pr | KEEP (item 1, 6) |
| a7t-ai/three-body-agent | 13 | mit | issue to PR on Actions; PR stays mergeable | open-pr | NOTE |
| sethdford/shipwright | 21 | mit | stale-evidence check: verify result must match current commit SHA | verify, compare-tests | KEEP (item 2) |
| zxkane/autonomous-dev-team | 38 | none | issue to merged PR with explicit lifecycle states | all | NOTE |
| daonhan/ralph | 24 | mit | docker sandbox plus bounded loop for the coding agent | build | NOTE (M2 sandbox exists; pipelines cannot run sandboxed) |
| jonit-dev/night-watch-cli | 50 | mit | PRD to PR overnight, pause/resume on failure | build | NOTE |
| yungookim/oh-my-pr | 46 | mit | PR babysitter: fetch reviewer comments and CI failures after open | open-pr | NOTE (needs a follow-up pipeline, not a hardening) |
| jeremymcs/patchdeck | 21 | mit | local-first PR lifecycle; PR/issue state read before acting | open-pr | KEEP (item 7, read existing PR first) |
| Geocodio/yak | 35 | mit | one task source to PR; retry with feedback on failure | build | NOTE |
| Shaurya-Sethi/nightshift | 14 | mit | issue resolve CLI; bounded retries | build | NOTE |
| KeshavCracks/Forge | 22 | mit | full-lifecycle agent with a plan then verify then PR | spec, verify | NOTE |
| nexu-io/looper | 132 | mit | reviewer/fixer loop before open-pr; success criteria drive the run | approve-pr | NOTE (two-engine-review covers review) |
| RapierCraftStudios/ForgeDock | 117 | agpl-3.0 | GitHub as memory; agpl so idea only | open-pr | NOTE |
| mr-karan/hodor | 112 | mit | review agent with grep/find/read tools and a changed-file budget | approve-pr | NOTE |
| attilaszasz/sdd-pilot | 97 | mit | Clarify step between Specify and Plan; structural validators on the plan | spec, spec-lint | KEEP (item 5) |
| syahiidkamil/Software-Engineer-AI-Agent-Atlas | 401 | none | proportional-change rule: block over-engineering; typed contracts | build, spec-lint | KEEP (item 8, size check) |
| Ricar66/omnistack-agent | 68 | mit | proportional change enforcement; evidence-based reporting | build | NOTE |
| FlyFission/nuclear-grade-context-engineering | 33 | mit | evidence-linked claims; actor-evidence coupling (author is not the verifier) | verify | KEEP (item 2, Taren's rule) |
| addxai/enterprise-harness-engineering | 44 | apache-2.0 | expert rules encoded as checks | verify | NOTE |
| lipingtababa/harness-engineering-playbook | 90 | none | closed-loop engineering; detect agents copying bad patterns | spec-lint, compare-tests | NOTE |
| codexstar69/bug-hunter | 519 | mit | source-drift check between plan and fix; fail-closed on missing evidence; skeptic pass | build, approve-spec | KEEP (item 2, drift = uncommitted/unpushed changes) |
| Corbell-AI/Corbell | 628 | apache-2.0 | feed real method signatures into the spec step | spec | NOTE (graph build is heavy; M4-3 owns code maps) |
| bdouble/pm-vibecode-ops | 42 | cc-by-4.0 | PM-style spec checklist for non-engineers | spec | NOTE |
| mickyarun/bodhiorchard | 28 | apache-2.0 | persistent decision store for spec consistency | spec | NOTE |
| sourceant/sourceant | 26 | mit | requirements and topology graph | spec | NOTE |
| wso2/labs-agentic-engineer | 25 | apache-2.0 | specialised agents per SDLC phase | all | NOTE |
| sam-agents/sam | 19 | mit | autonomous TDD agents; test-first enforced by workflow | build | KEEP (item 2, check a test was added) |
| KacemMathlouthi/metis | 19 | mit | isolated sandbox per task; findings shown inline as they arrive | build | NOTE |
| integry/propr | 16 | apache-2.0 | AI output turned into reviewable PRs; oversized-change override | approve-pr | KEEP (item 8) |
| chippingway/chipping-orchestrator | 16 | apache-2.0 | issue decomposed into ordered steps | spec | NOTE |
| oinsio/gnomish-factory | 13 | apache-2.0 | stateless step engine; stale-run detection | runner | NOTE |
| dimileeh/agent-workspace-fabric | 13 | apache-2.0 | control plane: tool gating, lifecycle states | build | NOTE |
| aeonfun/aeon | 767 | mit | execution timeout and stall detection; secret scoping | build | KEEP (item 3, retry clock) |
| KorroAi/mue-x | 277 | mit | backup and restore on failed mutation; syntax check before commit | build | NOTE |
| jerry-ai-dev/MODULAR-RAG-MCP-SERVER | 1167 | none | DEV_SPEC document drives the agent; skills encode steps | spec | NOTE |
| ASCIT31/Dark-Moon | 1012 | gpl-3.0 | re-test loop that confirms a fix against the original exploit | verify | NOTE (gpl, idea only) |
| QuantaAlpha/RepoMaster | 552 | none | auto-detect and configure env and dependencies for an unknown repo | build | KEEP (item 4, 9: runner detection and installs) |
| flatlogic/awesome-ai-software-development-agents | 188 | none | list of agents | none | NOTE |
| fatihkc/awesome-agentic-engineering | 23 | cc0-1.0 | list of practices | none | NOTE |
| awsm-research/agentic-swe-book | 29 | none | requirement elicitation by treating the AI as a client | spec | KEEP (item 5, ask before writing) |
| Ganesh-403/Repo-Sage | 26 | none | AST chunking and call graph for context | build | NOTE |
| aserhat81/OpenZion | 15 | none | local-LLM file edits | build | NOTE |
| ssdeanx/Gemini-CLI-Web | 67 | gpl-3.0 | tool toggle limits shell during build | build | NOTE |


NOTE for the reader: the scan marked every one of these repos as relevant to "spec-to-pr" by README similarity; most are whole products, not hardening sources. Only the KEEP rows connect to a verified failure below.

## 1.2 Hardening items, ranked

### S1. The build branch is cut from the project's current HEAD, not from base_branch, and repo is never compared to the project's remote
- Step: build (worktree), open-pr
- Code: core/src/pipelines/runner.ts:649 (`git worktree add dir -b branch HEAD`); inputs base_branch used only at pipelines/spec-to-pr.json:92; plugins/github/bin/github.js:19 pushes to `origin` and :22 passes `--repo input.repo`.
- Failure: project checkout is on `feature-x` (or local `main` is 12 commits behind `origin/main`), inputs.base_branch = "main". Build branch contains feature-x commits. The PR into main carries unrelated commits or conflicts. If `origin` is a fork or another repo than inputs.repo, push succeeds but `gh pr create --repo X --head branch` fails (head not found) after both gates.
- Fix: add an optional step field `base` (resolved string); placeIndex fetches `origin <base>` and branches from `origin/<base>`. In create-pr, read `git remote get-url origin`, compare with `repo`, and fail early with a plain message if they differ.
- Smallest failing test: fixture project with HEAD on a side branch holding one extra commit; run spec-to-pr with the fake engine; assert `git merge-base build-branch origin/main` equals origin/main tip and `git log origin/main..build-branch` contains no side-branch commit.
- Effort: 1.0
- Source: mraza007/baton (stale branch sync), RepoMaster (env detection).

### S2. Build can finish "done" with nothing committed, or with uncommitted changes, and verify tests the working tree, not the commit that gets pushed
- Step: build, verify, open-pr
- Code: runner.ts:592 (worktree/branch outputs added whenever the agent step is ok, no git check); pipelines/spec-to-pr.json:55 ("Commit your work"), :64-65 verify runs in the worktree; plugins/github/bin/github.js:19 pushes the branch.
- Failure: agent edits files, tests pass in the dirty working tree, agent forgets `git commit`. Gate says "Tests passed: true". Push sends zero new commits; `gh pr create` fails with "no commits between" or opens an empty PR. Or: the agent commits only half the files; the PR lacks code that passed tests. Also nothing checks that the agent added a test at all (vacuous pass: baseline green, verify green, no new test).
- Fix: new code step `check-build` between build and verify: `git rev-list --count <base>..HEAD` must be at least 1, `git status --porcelain` must be empty, and the diff must touch at least one path matching a test pattern. Results go into the approve-pr summary; commit count 0 or dirty tree fails the step.
- Smallest failing test: fake engine writes a file and does not commit; run reaches approve-pr today (assert it does not, or that the summary carries "uncommitted").
- Effort: 0.75
- Source: sam-agents/sam (test-first enforced), bug-hunter (source drift), shipwright (evidence tied to SHA), nuclear-grade-context-engineering (author is not the verifier).

### S3. The one retry after a failed agent attempt inherits the first attempt's clock
- Step: spec, build (any agent step)
- Code: runner.ts:807 (`started = Date.parse(a.row.started_at)`), :808 deadline; retry at :765 passes `{...a.row, session_id: null, status: 'running'}` so started_at is unchanged; markRunning at :551-552 keeps started_at when status is 'running'. Default timeout 30 minutes at :752; spec-to-pr.json sets no `timeout_minutes` on build.
- Failure: engine exits at minute 28 of a 30 minute build (rate limit, crash). Retry gets 2 minutes. A real repo build that needs 40 minutes is killed at 30 with no commit review. A timeout after a long first attempt makes the retry time out on its first poll.
- Fix: give the retry a fresh `started_at` (set it in the row passed to the second attempt and in run_step), and set `timeout_minutes: 60` on build in spec-to-pr.json (budget is 120).
- Smallest failing test: fake engine that exits with no output on attempt 1 after the test has set `timeout_minutes` so that elapsed time is past the deadline; assert attempt 2 gets a full window (today it times out immediately).
- Effort: 0.5
- Source: aeon (timeout and stall handling).

### S4. verify aborts the whole run when no test runner is found, and runner detection misses common layouts
- Step: verify (and baseline in build)
- Code: plugins/repo/bin/repo.js:92 (`fail("no test runner found")`), :36-39 (pytest only when pyproject.toml or pytest.ini exists; `tests/` alone or setup.cfg alone falls through to "none"), :38 `python -m pytest` (bare `python` can be the Store stub); runner.ts actionIndex returns ok false so the run fails after build, after two gates' worth of work; pipelines/spec-to-pr.json:62-66.
- Failure: repo with Makefile tests, `bun test`, jest config but no `scripts.test`, or pytest in `tests/` with no pyproject: spec and build complete, then verify fails the run; the committed branch is stranded and nothing reaches the gate.
- Fix: run-tests returns `{passed:false, exit_code:-1, runner:"none", output_tail:"no test runner found"}` instead of failing, so the gate shows "no tests were run" and the user decides; add `tests/` and setup.cfg pytest detection and use `py -m pytest` / `python3` per platform. Also run detect-tests once at run start and show the result on the first gate.
- Smallest failing test: fixture repo with only `tests/test_x.py`; call `run-tests` action; today it errors, expected an ok result with `passed:false`.
- Effort: 0.5
- Source: RepoMaster (detect and configure an unknown repo).

### S5. gh and push access are not checked until the last step
- Step: open-pr (start-of-run preflight missing)
- Code: core/src/pipelines/validate.ts:170-176 and store.ts:66-68 check only that the plugin is enabled (`requires`); plugins/github/bin/github.js:19-24 is the first use of git push and gh.
- Failure: gh logged out, no push rights on the repo, or base branch does not exist on the remote. The user approves two gates over an hour; open-pr then runs `git push` (which can succeed with git credentials) and `gh pr create` fails with "gh auth login" text. The branch is pushed but no PR exists.
- Fix: add action `github/doctor` ({repo, base}): `gh auth status`, `gh repo view <repo> --json viewerPermission`, `git ls-remote --heads origin <base>`. Run it as the first step of spec-to-pr (code or action step); fail with one plain line per missing thing.
- Smallest failing test: fake gh shim that exits 1 on `auth status`; run spec-to-pr; assert the run fails at the first step, with the engine never started.
- Effort: 0.75
- Source: patchdeck (read remote state before acting).

### S6. approve-pr does not say whether the base moved, so the PR may be unmergeable or stale
- Step: approve-pr, open-pr
- Code: plugins/github/bin/github.js:19-22 (no fetch, no merge-base check); pipelines/spec-to-pr.json:80 gate summary has no base info.
- Failure: build takes 40 minutes; main gets 5 new commits touching the same file. The gate shows green tests. PR opens with conflicts. (The product must not rebase for the user; it should only report.)
- Fix: in a code step before approve-pr: `git fetch origin <base>`, count `HEAD..origin/<base>`, run `git merge-tree` for a conflict check, and add "base moved N commits, conflicts: yes/no" to the summary. Tests that ran on the old base are named as such.
- Smallest failing test: fixture where origin/main advances with a conflicting edit after build; assert summary contains "conflicts: yes".
- Effort: 0.5
- Source: baton (stale branch sync), propr.

### S7. Retrying open-pr after a partial success fails with "already exists"
- Step: open-pr
- Code: plugins/github/bin/github.js:22-24 (any gh failure is fatal; manifest timeout 120 s in plugins/github/troop-plugin.json).
- Failure: `gh pr create` creates the PR but the call times out at 120 s (slow network). Run shows failed. User resumes; push is a no-op, `gh pr create` errors "a pull request ... already exists: <url>". The run stays failed though the PR is open.
- Fix: on that message, extract the URL from the error text (or call `gh pr view --head <branch> --json url`) and return `{url}`. Do the same check before create.
- Smallest failing test: fake gh that prints "a pull request for branch X into Y already exists: https://github.com/o/r/pull/9" and exits 1; assert action returns that url.
- Effort: 0.25
- Source: patchdeck, oh-my-pr (read PR state first).

### S8. compare-tests reports "0 new failures" when the suite crashed
- Step: compare-tests
- Code: plugins/repo/bin/repo.js:55-57 (failure names come from `not ok`, `FAIL`, `FAILED` lines only), pipelines/spec-to-pr/compare-tests.mjs:6,12.
- Failure: pytest collection error (output has `ERROR collecting tests/x.py`, exit 2) or a node:test run that dies on a syntax error before any TAP line: `failing` is `[]` or `unknown` is only returned when no format is recognised. With pytest header present and no `FAILED` lines, failing is `[]`, so the gate says "0 new failures (0 old)" with `passed: false`.
- Fix: in the repo plugin, if `passed` is false and the parsed list is empty, return `"unknown"`. Also parse pytest `ERROR ` lines as failures.
- Smallest failing test: feed failingTests the pytest text with a header and `ERROR collecting` line plus exit status 2 through run-tests (extend core/test/repo-failing.test.ts); expect `"unknown"`.
- Effort: 0.25
- Source: shipwright (do not trust a stale or empty result).

### S9. Dependencies are installed only for npm; baseline and verify on pnpm, yarn, uv repos run against an empty tree
- Step: build (baseline), verify
- Code: runner.ts:112-121 (only `package-lock.json`), pipelines/spec-to-pr.json:54 baseline_tests; repo.js:32 picks pnpm/yarn at run time.
- Failure: pnpm repo: worktree has no node_modules; baseline fails (every test fails with "cannot find module"), `old_failures` is the entire suite, and verify later shows the same list, so "0 new failures (all old)" hides that the tests never ran.
- Fix: choose installer by lockfile (pnpm-lock.yaml, yarn.lock, uv.lock, requirements.txt); if install fails or no installer applies for a repo with a manifest, mark the baseline `unknown` and print "dependencies not installed" in the gate.
- Smallest failing test: fixture with pnpm-lock.yaml and a fake `pnpm` on PATH recording args; assert it is called in the new worktree.
- Effort: 0.75
- Source: RepoMaster.

### S10. spec-lint passes vague specs and an over-large change reaches the PR gate unflagged
- Step: spec-lint, approve-pr
- Code: pipelines/spec-to-pr/spec-lint.mjs:56-58 (a behaviour bullet counts as covered if it shares any one word of 5+ letters with any check), :52-54 (any non-empty check line passes), flags never block; no size check anywhere before pipelines/spec-to-pr.json:80.
- Failure: idea "make it better". Spec has bullet "The export works for large files" and check "It works correctly". Shared word "works": no flag. Gate looks clean. Separately, a 40-file diff for a one-line idea reaches approve-pr with no size line.
- Fix: flag checks under 5 words or containing only vague words (works, correctly, properly, good, fast), flag TBD/TODO/"?" in the spec, flag an idea under 8 words at the first step by pausing for a clarifying answer. In the check-build step (S2) add "N files, M lines changed" to the gate and flag more than a set limit.
- Smallest failing test: add to core/test/spec-lint.test.ts the two strings above; expect at least one flag (today zero).
- Effort: 0.5
- Source: sdd-pilot (Clarify step), agentic-swe-book (elicit requirements), Atlas and propr (proportional change).

---------------------------------------------------------------------------

# 2. e2e-browser-qa

## 2.1 Repos (40 kept, 10 dropped as not relevant: openserp (SERP API), mobilegym, react-native-owl, LLMFeeder, awesome-ai-agent-platforms, spidercreator, Argus (red-team), vdiffr (R), x-use (X/Twitter), ultimate_mcp_server)

| repo | stars | licence | idea taken | step it improves | verdict |
|---|---|---|---|---|---|
| apify/crawlee | 26080 | apache-2.0 | wait for network idle and retry on transient errors | qa | NOTE |
| Skyvern-AI/skyvern | 23162 | agpl-3.0 | vision check of UI state, idea only (agpl) | qa | NOTE |
| nanobrowser/nanobrowser | 14018 | apache-2.0 | planner and navigator split | flows, qa | NOTE |
| browseros-ai/BrowserOS | 13851 | agpl-3.0 | session persistence in the browser | qa | NOTE (login item E4) |
| apify/crawlee-python | 9584 | apache-2.0 | same as crawlee | qa | NOTE |
| americanexpress/jest-image-snapshot | 3917 | apache-2.0 | mismatch threshold and size-mismatch handling | fix (backstop assist) | KEEP (item E7 for screenshots) |
| mojoaxel/awesome-regression-testing | 2418 | cc-by-sa-4.0 | catalogue of diff tools | none | NOTE |
| nottelabs/notte | 2019 | other | script-first with agent fallback | qa | NOTE |
| skalesapp/skales | 1947 | other | goal-based desktop agent | qa | NOTE |
| oblador/loki | 1914 | mit | stable screenshot capture: disable animations before capture | qa | KEEP (item E9) |
| hyperbrowserai/HyperAgent | 1593 | other | extract with schema validation | report | KEEP (item E1) |
| browserwing/browserwing | 1420 | mit | recorded scripts reused by the agent | qa | NOTE |
| ServiceNow/BrowserGym | 1394 | other | deterministic judge on state, not on pixels | recheck | KEEP (item E5) |
| reg-viz/reg-suit | 1298 | mit | HTML report with before/after/diff | report | NOTE |
| bug0inc/qa-agent | 1280 | other | plain-language browser steps with assertions | flows | KEEP (item E1: flow becomes checkable) |
| browserable/browserable | 1210 | mit | step state kept across retries | qa | NOTE |
| test-zeus-ai/testzeus-hercules | 1179 | agpl-3.0 | Gherkin steps from plain text; idea only | flows | NOTE |
| alumnium-hq/alumnium | 1015 | mit | natural-language assertions instead of selectors | qa, recheck | KEEP (item E5) |
| juliangruber/review | 902 | none | multi-resolution screenshots | qa | NOTE |
| Visual-Regression-Tracker | 719 | apache-2.0 | review UI for diffs; baseline update flow | report | NOTE |
| cypress-visual-regression | 661 | mit | threshold and baseline update | fix | NOTE |
| differencify | 639 | mit | mockRequests to stabilise external data | qa | KEEP (item E9) |
| happo/happo | 513 | none | accessibility check as a gate | qa | NOTE |
| reg-viz/reg-cli | 422 | mit | fast diff with threshold | fix | NOTE |
| Jeomon/Web-Use | 301 | mit | intelligent waiting after actions | qa | KEEP (item E9) |
| billy-enrizky/openbrowser-ai | 274 | mit | persistent code namespace across fix passes | fix | NOTE |
| haim-io/cypress-image-diff | 271 | mit | pixelmatch threshold | fix | NOTE |
| gsd-build/gsd-browser | 268 | apache-2.0 | snapshot refs, settle (network idle) before assert, auth vault | qa | KEEP (item E2, E4) |
| dragonked2/alphacode | 243 | mit | real browser plus OS automation | qa | NOTE |
| EDEAI/OpenFlux | 236 | mit | long-term memory in the fix agent | fix | NOTE |
| newsuk/AyeSpy | 222 | bsd-3-clause | high-performance screenshot compare | fix | NOTE |
| Mikuu/Micoo | 195 | mit | threshold compare service | fix | NOTE |
| pixsame/pixsame | 177 | mit | Cypress plugin diff | fix | NOTE |
| esinecan/agentic-ai-browser | 163 | none | structured DOM extraction and state machine | qa | NOTE |
| arguseyes/argus-eyes | 157 | none | CLI screenshot compare | fix | NOTE |
| leoxiaoping/pbottleRPA | 156 | mit | RPA with AI | qa | NOTE |
| webdriverio/visual-testing | 156 | mit | update-baseline workflow and ignore regions | fix | NOTE |
| skyfireitdiy/Jarvis | 143 | mit | symbolic impact analysis to find which files a fix touches | fix | NOTE |
| NiGhTTraX/mugshot | 138 | mit | framework-independent compare | fix | NOTE |
| Axolotl-QA/Axolotl | 220 | apache-2.0 | QA agent from code changes: generates and executes browser tests, evidence per verdict | qa, report | KEEP (item E5, E6) |

Only about 9 rows connect to a verified failure; the rest are screenshot-diff libraries (threshold, ignore regions) already covered by the backstopjs assist, useful only once a baseline image exists, which this pipeline never creates.

## 2.2 Hardening items, ranked

### E1. A missing or malformed findings.json reads as "no problems found"
- Step: qa (output), fix, report
- Code: pipelines/e2e-browser-qa/report.mjs:70-77 (`asFindings` returns [] on parse error or non-array), :81 (`.catch(() => '[]')` on a missing file); pipelines/e2e-browser-qa.json:39 (output key `findings` only has to exist; runner.ts:838 checks key presence, not that the file exists); core/test/e2e-browser-qa.test.ts:12 codifies the missing-file case.
- Failure: qa agent hits its timeout writing `[{"severity":"high","title":"Cart empty",` (truncated JSON), or writes prose into the file. Fix agent reads garbage and does nothing; report prints "Fixed (0) / Still open (0): None", tests passed. A broken run looks like a clean app.
- Fix: a code step `check-findings` right after qa: file exists, parses as an array, each item has severity in the enum and a non-empty title and detail; otherwise fail the run with the parse error. Report.mjs throws on malformed input instead of returning [].
- Smallest failing test: report.mjs run with findings.json = `[{"severity":"high"` ; assert it throws (today returns open: 0).
- Effort: 0.5
- Source: HyperAgent (schema-checked extract), bug0 qa-agent.

### E2. Dev server "ready" means any HTTP answer on the port, and the port flag is assumed
- Step: qa (dev_command)
- Code: core/src/pipelines/devserver.ts:23-32 (`answersOn` resolves true for any status, including 404 or 500), :72-87 (waitReady; 90 s); pipelines/e2e-browser-qa.json:35 (`npm run dev -- --port {{port}}`); devserver.ts:48 (env is process.env, no PORT); core/src/ports.ts:38 (a port is only tested free at lease time).
- Failure: (a) Next/Vite on a repo whose `dev` script is `node server.js` ignores `--port` and listens on 3000 or 8080: nothing answers on 3001, 90 s wasted, run fails "gave no response in 90 s". (b) Another app grabs the leased port in the gap; Vite without strictPort moves to 3002 while the foreign process answers on 3001: the agent QA-tests the wrong app and reports its bugs. (c) A compile error page returns 500 and counts as ready.
- Fix: set `PORT` in the dev server env; add `--strictPort`-style flag only for known frameworks (read package.json devDependencies); ready only when a GET / returns status below 500 and the spawned child is still alive; read package.json first and fail with "no dev script" in one line.
- Smallest failing test: fixture `dev` script that reads only process.env.PORT; assert waitReady succeeds (today it times out). Second test: stub server returning 500 on /: assert not ready.
- Effort: 0.5
- Source: gsd-browser (settle before assert), Web-Use (wait handling).

### E3. verify aborts the run when the app has no tests, so no report is written
- Step: reverify, report
- Code: plugins/repo/bin/repo.js:92 (`fail("no test runner found")`); runner actionIndex ok false fails the step; pipelines/e2e-browser-qa.json:51-57; the fix prompt itself says "where the repository has tests" (line 47), so no-test repos are an expected input.
- Failure: small app without a test script. qa finds 4 bugs, fix commits 4 changes, reverify fails the run, report never runs, user sees "run failed" with findings.json unread.
- Fix: same plugin change as S4 (return `passed:false, runner:none`), and report.mjs prints "no tests exist in this repo" instead of "failed".
- Smallest failing test: fixture without a test script; run the pipeline with the fake engine; assert the run completes and qa-report.md exists.
- Effort: 0.25 (shared with S4)
- Source: none.

### E4. A page behind login produces fake bugs, and fix then edits the auth
- Step: qa, fix
- Code: contracts/browser-tools.md:10 (agent pane starts logged out, storage cleared on close); pipelines/e2e-browser-qa.json:38 (prompt has no instruction for login walls or test credentials); no input for credentials or a seed route.
- Failure: app redirects every flow to /login. Agent records six "critical: flow redirected to /login" findings. The fix step, told to fix each finding, edits the auth guard or the redirect to make the flow reachable and commits it.
- Fix: add optional input `login_hint` (route or test account, no real secrets); qa prompt rule: if a flow is blocked by login and no hint exists, record one finding severity "blocked" and skip the flow. The fix prompt must skip "blocked" findings. Report lists them separately.
- Smallest failing test: report.mjs fed a "blocked" finding lists it under "Could not check", not "Still open" (add severity to the enum with the E1 check); plus a prompt-string test that the fix prompt excludes blocked.
- Effort: 0.75
- Source: gsd-browser (auth vault idea), BrowserOS (session persistence).

### E5. "Fixed" is the fix agent's word; nothing re-walks the flows and reverify only runs unit tests
- Step: fix, reverify, report
- Code: pipelines/e2e-browser-qa.json:47 (agent writes `fixed_by` itself), :51-57 (reverify is run-tests only); report.mjs:83-84 counts any finding with `fixed_by` as fixed; the dev server stays up until run end (runner.ts:280, 294), so a re-walk is cheap.
- Failure: fix agent sets `fixed_by` without a code change, or changes code that never ships to the running page (build output, cache). Tests pass because no test covers the flow. Report says "Fixed (4)". Stale pass.
- Fix: new agent step `recheck` (role visual-check, browser true, same pane): re-walk only findings marked fixed, set `verified: true/false`. Report counts only `verified` as fixed; the rest are "Fix claimed, not confirmed". Also require the fix step to add `commit` sha per finding.
- Smallest failing test: fake engine that sets fixed_by with no diff and a recheck fake that returns verified false; assert report lists it under not confirmed.
- Effort: 1.5
- Source: Alumnium (natural-language assertion), BrowserGym (judge on state), Axolotl (evidence per verdict).

### E6. Reverify failure cannot be told apart from failures that existed before the fixes
- Step: qa (worktree), reverify, report
- Code: pipelines/e2e-browser-qa.json:28-40 (qa has `worktree: true` but no `baseline_tests`), report.mjs:89 prints "failed (exit N)" only.
- Failure: repo with 3 failing tests on main. After the fixes reverify exits 1. Report says "Tests after the fixes: failed". User cannot tell whether the fixes broke something.
- Fix: set `baseline_tests: true` on qa (runner already supports it, runner.ts:605-625) and reuse `compareFailures` from pipelines/spec-to-pr/compare-tests.mjs in report.mjs: "0 new failures (3 old)".
- Smallest failing test: fixture with a pre-existing failing test; assert report contains "0 new failures".
- Effort: 0.4
- Source: none (reuses M4-10 I4).

### E7. Full-page screenshots are uncapped PNGs sent into the agent
- Step: qa
- Code: workbench/src/browser/panes.ts:574-582 (scale 1, up to MAX_CAPTURE_PX = 16,384 tall, PNG), core/src/hook/browser-mcp.ts:116-119 (returns base64 image content as is); pipelines/e2e-browser-qa.json:38 prompt says nothing about screenshots.
- Failure: agent calls `screenshot full_page` after each of 30 actions on a 12,000 px page: each a multi-MB PNG, token budget and the 30 minute step clock burn, or the engine rejects the oversize image and the step fails.
- Fix: downscale to a 1568 px long edge and encode as JPEG for full_page in browser-mcp; add one prompt line: "take a screenshot only to confirm a visual finding; use snapshot for everything else".
- Smallest failing test: fake pane returning a 16,384 px PNG; assert the MCP result is under a size cap and shorter than 1568 px.
- Effort: 0.4
- Source: jest-image-snapshot (size mismatch handling), loki.

### E8. Fix step has no scope or size limit and cannot see partial qa results
- Step: qa, fix
- Code: runner.ts:752 (30 minute default timeout, no timeout_minutes on qa in pipelines/e2e-browser-qa.json); the qa prompt (line 38) tells the agent to write findings.json at the end; an agent timeout (runner.ts:858) loses everything it found.
- Failure: 6 flows on a slow app take 35 minutes; qa times out; findings.json was never written; run fails with nothing to show. Also runs on a retry see the expired clock (S3).
- Fix: prompt says "append each finding to findings.json after each flow so far"; set `timeout_minutes: 45` on qa. The check in E1 then accepts a partial file and marks the run "partial".
- Smallest failing test: prompt-level: assert qa prompt contains the incremental-write rule and the step has timeout_minutes; behavioural: fake engine writes findings after flow 1 then hangs; assert a partial report is produced.
- Effort: 0.4
- Source: aeon-style stall handling (also S3).

### E9. Single sightings are reported as bugs; flaky pages and third-party noise create false findings
- Step: qa, report
- Code: pipelines/e2e-browser-qa.json:38 ("plus console errors and failed requests"): every console error and failed request becomes a finding, including favicon.ico 404s and ad/analytics failures; no reproduce rule.
- Failure: a transient 503 from a CDN, or a skipped animation, becomes a "medium" finding; the fix agent then invents a change for it.
- Fix: prompt rule: reproduce each candidate finding once before recording; ignore favicon, analytics and extension noise; finding gets `repro: n`. Report.mjs puts findings with repro below 2 under "Unconfirmed". Wait for network idle before reading the console (snapshot since_last after a settle).
- Smallest failing test: report.mjs with a finding `repro: 1` lands in "Unconfirmed", not "Still open".
- Effort: 0.4
- Source: Web-Use (intelligent waiting), loki (stable capture), differencify (mock external requests), Lastest-style flake triage.

### E10. flows.md is not checked, and flow start pages are not tied to the dev server
- Step: flows, qa
- Code: pipelines/e2e-browser-qa.json:25-26 (flows writes flows.md; only `summary` is required back); qa prompt :38 reads it without a check.
- Failure: flows agent writes 0 flows or 12; or start pages as `http://localhost:3000/` copied from the README. qa navigates there, the navigation allowlist blocks other loopback ports (contracts/browser-tools.md safety rule 2), and every flow reports "navigation blocked".
- Fix: require outputs `flows_count`; a code check that it is 3 to 6; tell the flows agent to write start pages as paths only, and have qa prompt resolve them against the pane's dev_port.
- Smallest failing test: flows.md with an absolute `http://localhost:3000/cart` start page; check step flags it.
- Effort: 0.25
- Source: bug0 qa-agent.

---------------------------------------------------------------------------

# 3. Cross-cutting notes

- S4 and E3 are one plugin change in plugins/repo/bin/repo.js:92 (no runner means a normal result, not an error). Do it once; it unblocks both pipelines for repos without tests.
- S3 and E8 share runner.ts:807: fix the retry clock once.
- S9 and E2 are the same family: the worktree is assumed to be an npm project with a lockfile.
- Not verified, left out: how the approve-pr gate behaves if the user edits the branch outside the app between approval and push (the gate's action_hash covers the step input, which includes the branch name but not its commit; runner.ts:970-992). Worth a look in a later pass.
