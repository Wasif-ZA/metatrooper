# `cite-check` plugin and `deep-research-cited`

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

Part of the MetaTrooper epic. Milestone 3. Effort: about 1 Claude Code days.

Depends on: child #15, child #17, child #23.

## What

`cite-check` plugin and `deep-research-cited`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Background. The run folds to the 36px wall bar with no live extra.

- Layouts: artifact-columns, run-log, coverage-map, pr-inline (citations), preview-stage (the report). Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens when `approve-plan` waits, `cite-check` still fails at loop max, or any step fails. Never on done.
- Pick, first match: a failure to run-log; loop max to pr-inline on the first unbound claim; `approve-plan` to
  artifact-columns. Opened by hand: preview-stage when done, coverage-map during `sweep`, `depth` or `critic`,
  run-log otherwise.
- Steps (two-engine decision, 2026-10-04): `decompose`, `approve-plan` (gate, approve), `sweep`, `depth` (fanout 4),
  `critic`, `draft`, `critics` (fanout 3), `patch`, `cite-check` (loop with `patch`, max 2). No deliver step: the
  report stays in the run folder.

## Acceptance criteria

- [ ] M3-01. Each milestone-3 built-in runs end to end on its fixture and stops at every gate before a publish step.
- [x] M3-02. `cite-check` fails a report with one planted quote absent from its source and passes the same report with curly quotes and extra whitespace in a real quote.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.

## Helper tools (M4-8)

| Helper | Repo | Licence | Risk | Egress | Step it helps |
|---|---|---|---|---|---|
| crawl4ai | unclecode/crawl4ai | Apache-2.0 | OK | not checked (fetches the pages you point it at) | depth |
| trafilatura | adbar/trafilatura | Apache-2.0 | OK | not checked | cite-check |
| gpt-researcher | assafelovic/gpt-researcher | Apache-2.0 | OK | uses a remote filter when `TYPESAFE_API_KEY` is set; otherwise not checked | sweep |
| local-deep-research | LearningCircuit/local-deep-research | MIT | OK | not checked (runs on Ollama; its "Private only" scope limits it to local sources) | sweep |

Helpers are optional. Each pipeline runs without them. They are listed in `pipelines/assists/registry.json` once the pipeline is built (registry format in `issues/m4-09-helper-tools.md`).

## Ideas (M4-8)

### Requirements

- Plan from a first search: `decompose` runs one quick search first and writes sub-questions that name what the results showed; the approve-plan card shows that evidence (assafelovic/gpt-researcher).
- Keyword filter before the model reads: a code step keeps only BM25-ranked passages per sub-question before the agent reads sources (assafelovic/gpt-researcher).
- Keep raw text for quotes, filtered text for reading: save both; agents read the fit text and `cite-check` matches quotes against the raw text (unclecode/crawl4ai).

### Notes

- Every learning carries its URL: `depth` writes `{insight, sourceUrl}` so `draft` cites only sourced learnings (assafelovic/gpt-researcher). Medium, S.
- Source cards with date and author, so `critic` can flag claims resting on old or authorless pages (adbar/trafilatura). Medium, S.
- Dead links before cite-check: a code pass over every cited URL, using `--format json` and `--cache` (lycheeverse/lychee). Medium, S.
- Journal quality on academic sources: check against open lists (OpenAlex, DOAJ, Stop Predatory Journals) in `critic` (LearningCircuit/local-deep-research). Low, M.
- Private-topic mode: a run input `private: true` limits `sweep` to local files and refuses remote engines (LearningCircuit/local-deep-research). Medium, M.

## Repo scan 2026-10-09

Relevant repos, top ideas and hardening for `deep-research-cited`: `ide-layer-research/m5-repo-scan-preview.md`, the section with the same name. Idea bank only; nothing there is built before launch (M5-D11).

Tag: M5 (after 12-01, per M5-D11). Nothing here is built before launch.

### Ideas

| Id | Idea, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| DC-I1 | Every claim carries a verbatim quote and a source id; uncited sentences are cut (AnotiaWang/deep-research-web-ui, KRLabsOrg/verbatim-rag, h4444433333/net-deep-research) | `draft`, `cite-check` (`plugins/cite-check/bin/cite-check.js` `check`) | Partly true: `draft` asks for a quote and id on every claim, and `check` flags uncited sentences, but only those containing a digit (`cite-check.js:66`). A new input `strict: true`, set by the pipeline, flags every uncited sentence of 8 or more words outside headings, tables and a `## Limits` section. `patch` deletes or cites each one | A fixture report with one uncited 10-word sentence without digits fails with reason "uncited sentence". The same sentence under `## Limits` passes | 0.3 |
| DC-I2 | Numbers and dates that disagree across sources become a conflict list, not a silent pick (damionrashford/RivalSearchMCP, SamurAIGPT/llm-wiki-agent) | `critic`, `draft` | `critic` also writes `<run>/conflicts.json`: a list of `{claim, values: [{value, source_id, quote}]}` for every number or date that sources give differently. `draft` must report each conflict with both values and both ids, never one value alone. `cite-check` checks the quotes as usual | On fixture sources that give a figure as 40% and 45%, `conflicts.json` has one entry and `report.md` cites both values with both ids | 0.4 |
| DC-I3 | Grade each saved source and filter by domain tier (h4444433333/net-deep-research, zoharbabin/web-researcher-mcp) | new code step `grade` after `sweep`; `depth` | `grade` adds `tier` to each entry in `sources.json`: 1 for government, education and journal domains or DOI and arXiv links, 2 for known news outlets (a list kept in the plugin), 3 for anything else, 4 for `excerpt_only`. `depth` is told to rest each position on tier 1 or 2 when one exists, and to name the tier when only 3 or 4 are available | On the fixture `sources.json`, a `.gov` source gets tier 1, an excerpt-only source gets tier 4, and the step writes no other changes to the file | 0.5 |
| DC-I4 | Resolve citations against real metadata (DOI, arXiv id) before the quote check, and test whether the quote supports the claim (blazickjp/arxiv-mcp-server, Aryan-Pardeshi/DeepResearch_AI, Liyan06/MiniCheck, serenakeyitan/citation-check-skill) | `cite-check`; new agent step `support` after the loop | `check` resolves a source whose URL is a DOI or arXiv link through the public Crossref or arXiv API, using `safeFetch`. A source that does not resolve goes into `dead_links` with "id not found". A new agent step `support` reads each bound claim with its quote and writes `<run>/support.json` with `supports: yes, partly, no`. Every `no` goes into the final report's failed list (DC-H3) | A fixture source with a made-up DOI lands in `dead_links` with "id not found". A fixture claim whose quote is on another subject is marked `no` in `support.json` | 1.0 |
| DC-I5 | Show the plan and do not search until approved (Weizhena/Deep-Research-skills, Socialpranker/deepdive, mjasnikovs/pi-task) | `approve-plan` | Already true: `pipelines/deep-research-cited.json`, `decompose` says "Do not search yet", and the `approve-plan` gate comes before `sweep` | Covered by the existing pipeline validation | 0 |

Worked: 0.3 + 0.4 + 0.5 + 1.0 + 0 = 2.2 CC days.

### Hardening

| Id | Failure, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| DC-H1 | Rate limits and dead providers stop the run (dzhng/deep-research, extracurricular-ai/open-deep-research-with-web-ui, Johell1NS/browser-search) | `sweep` (`plugins/agent-reach/bin/search.js` `search`) | Today every query goes to Exa only, and a failed query is skipped (`search.js:43`). When Exa fails for a query (no key, 429, 5xx or a timeout), `search` tries a second provider (Jina search, with its own secret) before giving up. The step output gains `fallback_queries`, and the run screen shows how many queries used it | With Exa faked to answer 429 and Jina faked to answer, every query gets sources and `fallback_queries` equals the number of queries | 0.5 |
| DC-H2 | The gap loop never ends on a hard query (qx-labs/agents-deep-research, mshumer/OpenDeepResearcher, LiXin97/agora-lab) | `patch`, `cite-check` | Already true: the only loop is `patch` and `cite-check` with `max: 2`, and the run has `max_usd: 5` and `max_minutes: 40` (`pipelines/deep-research-cited.json`). At `max` the run pauses with `loop-max` (`contracts/pipelines.md:155`) | Covered by the existing loop tests | 0 |
| DC-H3 | A fabricated quote ships after the patch rounds run out (jordan-gibbs/hyperresearch, superwesleyhys-ux/factcircuit) | new code step `finalise` after the loop | After `loop-max`, a resume carries on past the loop (`contracts/pipelines.md:223`), so today the run can end with failed quotes still in `report.md`. `finalise` reads `quote-check.json`, and `support.json` when DC-I4 is built. When anything failed, it puts a "Failed checks" section at the top of `report.md` listing each line, sentence and reason, and sets the output `clean: false`. The run screen shows that section first | A fixture where `quote-check.json` has one unbound quote ends with "Failed checks" at the top of `report.md`, holding that line, and `clean: false` | 0.4 |
| DC-H4 | Syndicated copies of one article count as several sources (jordan-gibbs/hyperresearch, mshumer/OpenDeepResearcher) | `sweep` (`search.js`) | Partly true: exact duplicate URLs are dropped (`search.js:45`). After saving, a source whose text shares 80% or more of its 8-word shingles with an earlier source gets `duplicate_of: <id>`. `depth` and `critic` are told to count such sources as one | Two fixture pages with the same article under different URLs give one source with `duplicate_of` pointing at the other | 0.4 |
| DC-H5 | A crash or timeout loses the whole run (extracurricular-ai/open-deep-research-with-web-ui, mjasnikovs/pi-task, LiXin97/agora-lab) | `sweep` (`search.js`) | Partly true: resume restarts from the first step not done (`contracts/pipelines.md:156`), but `sweep` writes `sources.json` only at the end (`search.js:63`), so a crash mid-sweep loses every saved source. `search` writes `sources.json` after each query, and on a rerun it skips queries already present | With the fake search set to throw on query 4 of 6, a rerun calls search for queries 4 to 6 only and `sources.json` ends with sources from all six | 0.3 |

Worked: 0.5 + 0 + 0.4 + 0.4 + 0.3 = 1.6 CC days. Both tables: 2.2 + 1.6 = 3.8 CC days.
