# Decisions and cuts

Everything deliberately not built, with the reason. Nothing here was forgotten, it was
decided.

Every entry carries `revisit: v2-jev`. These cuts are provisional on the engine available
at the time, not permanent. A good number were made because a rule-based engine cannot make
the judgement safely enough. Jev, a typed probabilistic decider released
2026-09-15 at $0.042 per million input tokens, changes that calculation, so each of these
gets re-examined when it lands rather than being silently inherited.

## Cut because someone else already ships it

| Cut | Reason | Revisit |
|-----|--------|---------|
| Output compression and summarisation | Headroom, Apache 2.0, already does 60% to 95%. Compose with it, do not rebuild it | v2-jev |
| Proxy mode, LLM-API-level interception | Headroom covers it and the surface is far larger than the wedge justifies | v2-jev |
| Shaper-only v1 | Overruled once Headroom was identified. The eval survives as C9, the shaper does not | v2-jev |
| Tool search for Claude Code specifically | Claude Code already defers tool schemas. Schema pruning survives in C3 only because Codex and Antigravity have no equivalent | v2-jev |

## Cut because the measurement does not support it

| Cut | Reason | Revisit |
|-----|--------|---------|
| Result cache (C4) | 33 exact repeats out of 2,886 calls. Perfect-cache ceiling is 2,353 tokens, 0.12% of spend, for 14 hours | v2-jev |
| Ranking over MCP servers alone | Only 3 MCP servers configured, one timing out, and all MCP combined is 1.71% of spend | v2-jev |
| A plain aggregator with no differentiator | Competes head on with MetaMCP and Bifrost with none of their maturity | v2-jev |
| CLI wrapping with no ranking | Drops the find-the-best half that started the project | v2-jev |
| Claimed runaway-loop savings of 8,000 to 20,000 tokens | Not visible in the history. 41 retry signals, no thrashing. The feature may still be built, the claim is not quoted | v2-jev |

## Cut on architecture

| Cut | Reason | Revisit |
|-----|--------|---------|
| TypeScript | 217 tracked `.py` against effectively no TypeScript, and the code must be defensible by hand | v2-jev |
| Auto-wrapping every binary on PATH | Blast radius. Allowlist seeded from the 155 binaries already called 20 or more times | v2-jev |
| Embedding-based tool search | Substring plus help-text matching until that demonstrably fails | v2-jev |
| Hooks as the foundation | Only Claude Code has them. MCP is the portable spine, hooks are an accelerator on one host | v2-jev |
| Replacing the Bash tool entirely | Any registry gap hard-blocks the agent mid-task, and gaps are constant early on | v2-jev |
| Coexisting as a plain MCP server | The model keeps picking Bash, the leaderboard starves, the differentiator never arrives | v2-jev |
| One single mega-issue | 176 hours with no internal checkpoints is the shape of a project that stalls at 60% | v2-jev |
| Templates-first build order | Templates need the call log and normalised shapes underneath, so C1 gets built either way | v2-jev |

## Cut on safety

| Cut | Reason | Revisit |
|-----|--------|---------|
| Git-based rollback | Automatic git mutation is forbidden, and `git stash` can swallow the diagnostics needed to debug the crash. Replaced by file-copy snapshots in C10 | v2-jev |
| Silent tool substitution | Replaced by marked substitution, enforced by `Decision.marker`. The feature lives, the silence does not | v2-jev |

## Cut on the local model's role

A local model was wanted but its role was undecided. Ollama is not currently running on the
development laptop, verified by `127.0.0.1:11434` returning no response.

| Role | Verdict | Reason |
|------|---------|--------|
| Extract templates, cluster repeated calls, name intents | Kept, in C5 | Batch, offline, no latency pressure, mechanical structure work |
| Label call intent for supersession matching | Kept, in C5 | Runs once per new shape, then cached |
| Pick the tool in the hot path | Cut | One 12 GiB GPU, one model at a time, latency on every call. Jev does typed decisions far cheaper |
| Summarise or compress results | Cut | That is compression, already cut to Headroom |
| Decide whether a call is safe to cache | Cut | That is a rule table. A model may propose entries, a human approves them |

## Cut on naming

| Cut | Reason |
|-----|--------|
| ToolRouter | `toolrouter` taken on PyPI, so project and package names would diverge permanently |
| ToolScout, ToolRank, ToolGauge, ToolPilot | Abandoned the `*Router` convention |
| OmniRouter | "Omni" claims total coverage that a 155-binary allowlist cannot honour |
| LeanRouter | Points at output compression, the one thing explicitly not being built |
| MetaRouter | Blends into a crowded naming pattern and says nothing about the scoring |

`toolrouter` and `call-router` were both free on PyPI as of 2026-09-27.

## Deferred to v2, not cut

| Item | Why deferred |
|------|--------------|
| Jev-powered tool selection | The differentiator, but it needs C3 and C5 underneath first |
| Community leaderboard, anonymised rankings pooled across installs | The real moat and the true OpenRouter parallel. Needs privacy design and hosting, both out of v1 |

## Standing question, answered 2026-09-27

Not as a router, not now. The measurement tool ships; the router waits for evidence from other
users' transcripts that this one machine cannot give.

The original framing:

Whether any of this should be built as a product. A second model asked to review the plan
adversarially returned `BUILD_MUCH_SMALLER` and rated sellability at zero, citing roughly
130 entrenched competitors and a known distribution weakness. That assessment is recorded,
not accepted. It was produced by a model that had written nine of the features it was
reviewing.

The measurement in `measurement.md` is arguably the more valuable output of this work than
the tool itself, and it is independent of whichever plan is chosen.

## Cut on 2026-09-27, when Plan A was chosen

| Cut | Reason | Revisit |
|-----|--------|---------|
| Plan B, 176 hours | 146 hours beyond Plan A chase a combined ceiling near 11% | v2-jev |
| C7 shell rewrite and cap | Claude Code's `bashOutputMaxChars` already caps Bash output and spills the rest to a file, so nothing is lost. A rewritten `\| head` loses it | v2-jev |
| C9 replay sandbox | Existed to prove C7's rewrite rules safe. No rewrite rules, nothing to prove | v2-jev |
| C1 SQLite store and live hooks | The transcripts already log every call. `ingest` reads them and saves a JSON summary per run | v2-jev |
| Headroom as the capper | Only proxy mode caps output, and proxy mode switches off Remote Control | v2-jev |

## Cut on 2026-09-28, when the direction changed to a command-only tool memory

| Cut | Reason | Revisit |
|-----|--------|---------|
| Hooks of any kind, including the Read hook | Wasif wants Claude Code's own flow untouched. Hooks are rejected, not deferred | never |
| A skill | A skill listing costs tokens in every session. A command costs nothing until it is run | v2-jev |
| Bash output cap (`BASH_MAX_OUTPUT_LENGTH`) | He does not want caps; they change how Claude Code behaves. Shrinking happens inside metarouter, with the full output kept in a log | never |
| Wrapping gstack browse | He wants his own browser tooling, not a dependency on someone else's. Replaced by an own CDP driver over Chrome's pipe | never |
| Playwright | Same reason, and Apache 2.0 fails the MIT gate if metarouter is ever sold | v2-jev |
| Computer use in v1 | Moved to v2. The goal is recorded in `spec.md`: an agent cursor of its own that does not take over his mouse | v2 |
| Blocking breaker | A command-only tool must never refuse a call the agent chose. The breaker now warns only | v2-jev |
| SQLite store | JSON lines are enough for an append-only call log with no queries yet | v2-jev |

Still cut from before: the result cache (ceiling 0.12%).

## Decided 2026-09-30, after the Codex and Gemini review

| Item | Decision | Revisit |
|------|----------|---------|
| Logging lookup lanes | Only lanes that run something log. `list`, `search` and the rest would fill the call log with noise `learn` has to ignore | never |
| Redirects to a blocked host in `page` and `screenshot` | Not caught. `page` is fetched by r.jina.ai on its side and `screenshot` by the Playwright CLI, so metarouter never sees the redirect. `up` and `browse` do catch it. Use `browse` for anything that might redirect somewhere sensitive | when `screenshot` moves onto the own CDP driver |

## Decided 2026-10-02, catalogue and modes

| Item | Decision | Revisit |
|------|----------|---------|
| Generic catalogue of popular CLIs and MCP servers | Built, reversing the 2026-09-28 "tailored only" line at Wasif's request. It ships as data (`recipes/catalog.json`, `mcp_catalog.json`) and is off unless `mode auto` is set, so `learn` mode behaves exactly as before | after a week of `ingest` shows which catalogue recipes get used |
| Auto-wrapping every binary on PATH (cut above) | Partly reversed. In `auto` mode `search` lists matching PATH binaries and `tools <bin>` prints its `--help`. Nothing is wrapped or run without being asked | never |
| Public MCP registry | `auto` mode searches registry.modelcontextprotocol.io and launches stdio servers by their registry name. Registry search has no popularity order, so the curated catalogue is listed first | when the registry adds ranking |
| Catalogue servers that need a key | Config only. The error names the missing variable; values are never stored | never |
| metarouter as the default tool | Made default by instruction only: the vault CLAUDE.md and `~/.codex/AGENTS.md`. Hooks stay rejected (row above, 2026-09-28) because Wasif wants Claude Code's own flow untouched | never |
| Commands agents typed instead of using metarouter | Caught after the fact, not live. `learn` mines the transcripts (also from `nightly.cmd`); in `auto` mode a shape used 5+ times at 80%+ success is saved as a `learned` recipe, in `learn` mode it waits for `learn --review`. Shapes matching ACU words (acu, redcap, hwbreport, partner, participant, survey) are never auto-saved | after the first week of nightly runs |
| sqlite and desktop-commander servers | Dropped by the verifier: sqlite is archived with no replacement, desktop-commander duplicates the shell and file tools | never |

## Decided 2026-10-02, the twelve research ideas

Built by Gemini (agy work lane) and Codex, one job at a time, after a Gemini spec gate. Source:
a gh research pass over rtk, context-mode, tldr, mcporter, SWE-agent, navi, Voyager and others.

| Item | Decision | Revisit |
|------|----------|---------|
| Per-command filters (`metarouter/filters/*.json`) | Built. This reverses the spec line "chosen by what the output looks like, not by which tool made it", for matched commands only and only when they exit 0. Six filters for the commands the call log shows most (npm install, pip install, pytest, git push/pull, gh run view, uv sync), each with tests that `check` runs. Written fresh, nothing copied from rtk | when a filter hides something an agent needed |
| `exec --want` | Built. Mechanism borrowed from context-mode (Elastic License 2.0), no code copied. In-memory chunk scoring of one output; no index, no cache | never |
| tldr pages | `tools <bin>` shows the tldr page; learned recipes take their summary from the best-matching tldr example. Pages are CC-BY 4.0: fetched on demand, cached under `~/.metarouter/tldr/` with the credit line kept in the cached file | never |
| Auto-saved learned recipes | Tightened. Saved only with an example from one real use that exits 0 in an empty temporary folder (where `check` runs it), and only when the body is on a read-only allowlist (git status/log/diff/show..., --version calls, npm ls/view, pip list/show, docker ps). A denylist was rejected: `git checkout -- .`, `git stash` and `npm run` would pass as reads. Everything else waits for `learn --review` | after a week of nightly runs |
| Learned flows | `learn` proposes command pairs that run back to back 5+ times; never auto-saved | never |
| MCP keep-alive helper | Built, with the same 30-minute idle stop as `browse` and `metarouter mcp stop`. Off in tests (`tests/conftest.py`), because each test run otherwise left four helpers running | never |
| MCP over HTTP | Built for registry servers that are remote-only. Header values with a `{variable}` read it from the environment; optional ones are left out | never |
| Python floor | Raised to 3.11 for `tomllib` (lint-gated `replace`, `mcp import`) | never |

## Decided 2026-10-03, the name

| Decision | Reason |
|-----|--------|
| Renamed to `metarouter` (toolrouter, then toolbook for one day) | `toolrouter` is taken on PyPI and npm by ToolRouter Inc. Wasif did not take to toolbook. `metarouter` is free on PyPI and npm, the largest GitHub repo with the name has 12 stars, and it joins metatrooper in one meta* family. This reverses the MetaRouter cut above, which was made when the tool still ranked tools |
