# Where agent tokens actually go

Measured 2026-09-27T21:40+10:00 from 102 Claude Code session transcripts,
41,209 lines, at `~/.claude/projects/**/*.jsonl`.

This document is the evidence base for every decision in `spec.md` and every cut in
`decisions.md`. It is also the most reusable thing in this repo: the numbers are not
specific to CallRouter and nobody appears to have published equivalents.

## Method

Two passes over the transcripts. Pass one maps every `tool_use_id` to its tool name from
assistant `tool_use` blocks. Pass two attributes each `tool_result` back to that tool.

Token estimates: text costs `len(text) // 4`. Images cost 1,500 each, because Claude caps
a large image near 1,590 tokens. Counting image base64 as bytes over four would overstate
images by roughly 40x, which is the error that produced a wrong first answer here.

Results are deduplicated by `tool_use_id`. An earlier pass did not deduplicate and
inflated every total by about 48 percent. The figures below are the corrected ones.

## Headline

Total tool-result tokens: **1,918,563** across 4,329 unique tool results.

| Tool | Calls | Tokens | Share | Avg |
|------|------:|-------:|------:|----:|
| Bash | 2,886 | 1,212,448 | 63.2% | 420 |
| Read | 272 | 556,028 | 29.0% | 2,044 |
| Edit | 431 | 21,852 | 1.1% | 50 |
| WebSearch | 30 | 21,755 | 1.1% | 725 |
| AskUserQuestion | 77 | 18,992 | 1.0% | 246 |
| Write | 318 | 15,439 | 0.8% | 48 |
| Grep | 25 | 10,010 | 0.5% | 400 |
| **All MCP servers** | **37** | **32,902** | **1.71%** | 889 |

Shell output and file reads are 92.2% of it. Every MCP server combined is 1.71%.

## Shape of the shell output

| Statistic | Tokens |
|-----------|-------:|
| median | 135 |
| mean | 420 |
| p90 | 1,050 |
| p99 | 4,198 |
| max | 7,201 |

- Top 5% of calls, 144 of them, carry 468,569 tokens, 39% of all shell output.
- 438 calls, 15%, return 25 tokens or fewer. Pure round-trip overhead.
- Calls involving `cat`: 432 calls, 428,872 tokens. The single fattest pattern.

It is a heavy tail on top of a floor of near-empty calls.

## The 16.3% nothing can touch

209 image blocks came back inside Read results, costing roughly 313,500 tokens. That is
16.3% of the entire tool-result spend, in screenshots and rendered PDF pages.

No router, cache, template or catalog affects a screenshot. The only available lever is
taking fewer of them, or taking them smaller. Worth knowing before designing anything that
claims to cut agent token cost.

## Failure corpus

203 errors across 4,329 tool results, 4.7%.

| Tool | Calls | Errors | Rate |
|------|------:|-------:|-----:|
| Bash | 2,878 | 163 | 5.7% |
| PowerShell | 57 | 7 | 12.3% |
| Read | 272 | 12 | 4.4% |
| Write | 317 | 5 | 1.6% |
| Edit | 426 | 4 | 0.9% |

Signatures: 55 exit-1, 30 exit-2, 21 tracebacks, 17 generic `error:`, 15 no-such-file,
5 command-not-found. Only 41 crude retry signals, so there is no evidence of the long
thrashing loops that failure-recovery features are usually justified by.

Spread across 155 distinct binaries, 203 errors is about 1.3 per binary. That is not
enough signal to learn a failure-to-recovery mapping from.

## The decisive test

Each feature was scored by its ceiling: the saving if it worked perfectly, before paying
for any of the machinery that makes it work.

### A. Capping shell output

| Cap | Saves | Share of shell | Share of all tokens |
|----:|------:|---------------:|--------------------:|
| 400 | 666,041 | 55.0% | 34.7% |
| 800 | 447,459 | 36.9% | 23.3% |
| 2,000 | 182,067 | 15.0% | 9.5% |
| 4,000 | 43,840 | 3.6% | 2.3% |

No ranking, no registry, no MCP. Just a cap.

### B. Failure recovery ceiling

161 error results cost 29,826 tokens, 2.5% of shell output. Granting a 3x multiplier for
the reasoning turn each error triggers gives a ceiling of 89,478 tokens, 4.7% of all
tokens, for 22 hours of work.

### C. Cache ceiling

Grouping by (project, exact command):

- 2,850 distinct commands across 2,886 calls
- **33 repeat calls, 1.1%**
- **2,353 tokens in repeats, 0.12% of all tokens**

That is the ceiling for a perfect cache with zero staleness cost. The cache is dead.

### D. Template ceiling

Normalising commands into shapes by replacing quoted strings and numbers:

- 2,421 distinct shapes across 2,886 calls
- 26 shapes seen five or more times
- Those cover 271 calls (9.4%) and 114,709 tokens (9.5% of shell, 6.0% of all)

Most repeated shapes:

| Count | Tokens | Shape |
|------:|-------:|-------|
| 38 | 5,574 | `timeout N ssh -o BatchMode=yes agent-laptop S N>&N \| tail -N` |
| 28 | 6,283 | `cd S && python -c S` |
| 23 | 2,600 | `cd <portfolio> && python - <<S` |
| 21 | 26,154 | `cat S` |
| 17 | 2,235 | `cat S N>/dev/null \| tail -N` |
| 17 | 114 | `cd S && bash meta/scripts/now-iso.sh` |

The heaviest repeated shape is `cat S`, which capping already handles.

## What this means

Ranked by measured value per hour of work:

| Feature | Ceiling | Hours | Tokens per hour |
|---------|--------:|------:|----------------:|
| Cap shell output | 666,041 | 10 | 66,600 |
| Templates | 114,709 | 24 | 4,800 |
| Failure intelligence | 89,478 | 22 | 4,100 |
| Cache | 2,353 | 14 | 170 |

The cheapest feature is worth more than the other three combined, and it needs none of the
router. The most expensive per token saved is 390x worse than the cheapest.

## Caveats worth stating

1. This measures one developer's past usage. A product serves other people, whose patterns
   may differ. Nothing here proves the router is worthless in general, only that it is
   worthless for this machine.
2. Ceilings are generous by construction. Real savings are lower because every feature
   costs tokens to operate and occasionally makes things worse.
3. Token estimates use a four-bytes-per-token heuristic and a flat image cost. Good enough
   to rank options by an order of magnitude, not good enough for billing.
4. Only tool results are counted. The full bill also includes system prompt, tool schemas
   and context re-sent on every turn. Tool results are the part these features could shape,
   and they compound, because a result stays in context and is re-sent on later turns.

## Reproducing

The analysis scripts were written against the transcript format directly with no
dependencies beyond the Python standard library. They are not committed here yet; the
first plan item is to port them into `callrouter/ingest.py`, where they become the backfill
path and stop being throwaway.
