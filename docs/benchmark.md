# Step 0 result: does Headroom make CallRouter unnecessary?

**No. Build C7.**

Run 2026-09-27T22:10+10:00 with `headroom-ai` 0.39.1 against 1,028 real Bash tool
outputs (1,057,075 tokens) pulled from local Claude Code transcripts. Harness is
`bench/headroom_bench.py`, results in `bench/results.json`.

## Result

| Arm | Tokens out | Saved | Reduction | Needle survival |
|-----|-----------:|------:|----------:|----------------:|
| original | 1,057,075 | | | |
| Headroom `compress()` | 1,012,821 | 44,254 | 4.2% | 98.4% |
| truncate to Headroom's size | 1,013,979 | 43,096 | 4.1% | 99.9% |
| fixed cap, 400 tokens | 394,903 | 662,172 | 62.6% | 98.8% |
| **smart cap, 400 tokens** | **397,009** | **660,066** | **62.4%** | **99.0%** |

A 400 token cap saves **15x more than Headroom** on this workload, and loses fewer
needles doing it.

## Why Headroom saves so little here

Its own transform log explains it:

| Transform | Count | Share |
|-----------|------:|------:|
| `router:noop` | 744 | 72.4% |
| `router:protected:error_output` | 108 | 10.5% |
| `router:tool_result:mixed` | 74 | 7.2% |
| `router:tool_result:lossless_search` | 27 | 2.6% |
| `router:tool_result:lossless_paths` | 26 | 2.5% |
| `router:tool_result:tabular` | 14 | 1.4% |

Headroom declines to compress 72% of these outputs and explicitly protects another
10.5% as error output. It left 860 of 1,028 outputs unchanged.

**This is not a defect.** Headroom is a general-purpose product where silently eating
someone's output is catastrophic, so it is tuned to never break anything and only acts
when it is confident. That is the correct default for a tool shipped to strangers. It
just means it leaves most of the available saving on the table for this particular
workload, which is a lot of large, unstructured shell output.

When Headroom does fire it works well. On the single largest output, 7,201 tokens, it
cut 36% via `router:tool_result:mixed`.

## What was borrowed

`router:protected:error_output` is a good idea and the `smart cap` arm implements it:
cap the output, but never drop a line matching an error pattern. It costs 2,106 tokens
against the naive cap (62.4% versus 62.6%) and raises needle survival from 98.8% to
99.0%. Nearly free, so C7 should ship it.

## Method

- Corpus: every Bash `tool_result` of 250 tokens or more, deduplicated by
  `tool_use_id`, from `~/.claude/projects/**/*.jsonl`. 250 is Headroom's own
  `min_tokens_to_compress` floor.
- Headroom is called as a library, `headroom.compress()`. No network path, verified by
  reading the module: every HTTP reference in `compress.py` is inside a docstring
  example. Run with `HEADROOM_BEACON=off DO_NOT_TRACK=1` because its upload beacon is
  on by default.
- Config overrides matter. Two defaults would have silently produced a fake zero:
  `compress_user_messages=False` (tool results ride on user-role messages) and
  `protect_recent=4` (the last four messages are never touched). Both were overridden.
- Needles are lines that must survive: tracebacks, command-not-found, no-such-file,
  `fatal:`/`error:` lines, exit codes, plus the final non-empty line, which is very
  often the answer. Survival is exact substring match, falling back to 80% word overlap
  for reflowed text.
- Speed: 10 ms per output, 9.8 s for the full corpus.

## Two bugs found in this harness, recorded so they are not repeated

1. **Comparing the whole conversation against the bare output.** The first version
   summed every message returned by `compress()`, including the serialised `tool_use`
   block, and compared it against the original output alone. The scaffold overhead
   swamped real savings and reported 1.2% with "24 of 25 unchanged". Fixed by comparing
   tool-result to tool-result.
2. **Sizing truncation to Headroom's output.** That arm is equal-budget by
   construction, so whenever Headroom no-ops the truncation arm no-ops too and the two
   look identical. It is kept as a quality control, but the decision-relevant arm is
   the fixed cap, which saves regardless of what any router decides.

Both bugs pointed the same way: they made Headroom look worse than it is. Worth stating
plainly, because the conclusion here is that Headroom underperforms on this workload and
that conclusion should not rest on a measurement error.

## Caveats

1. Needle survival is a proxy. The real question is whether the agent behaves
   identically, which needs a live A/B, not a string match.
2. 99.0% still loses 10 needles of 975. Those are cases where the answer got cut and
   the agent would have to re-run the command, which costs more than it saved.
3. This tests one function on one content type. Headroom also does cross-turn context
   compression, memory, image handling and a proxy path, none of which are measured
   here. It is not a verdict on Headroom, only on whether it covers this specific gap.
4. Token counts use a four-bytes-per-token estimate, applied identically to every arm.

## Consequence for the plan

Step 0 in `spec.md` is answered. Headroom does not cover the 62% that capping is worth
on this workload, so Plan A's C7 has a measured justification. The rest of the plan is
unaffected: this says nothing about the registry, ranking, templates or catalog, all of
which remain governed by the ceilings in `measurement.md`.

## 2026-09-28: callrouter's own shrinker

`bench/shrink_bench.py` runs the phase 1 text and JSON shrinker over the same kind of corpus,
with the same needle rules and matching rule as `headroom_bench.py`. The corpus has grown
since the Headroom run: every Bash output of 250 tokens or more, 4,577 of them.

| Arm | Tokens in | Tokens out | Reduction | Needle survival |
|-----|----------:|-----------:|----------:|----------------:|
| callrouter shrink | 4,756,954 | 832,426 | 82.5% | 99.93% (4,288 of 4,291) |

The first run scored 98.21%. Every miss was an `error:` or `fatal:` line with text before it,
because the smart cap pattern only matched those at the start of a line. Allowing them after
whitespace fixed it. The two error needles still lost sit past the 40-line limit, and they
are in the log.

Not like for like with the 62.4% row above: the smart cap keeps the head and tail of every
output, while the shrinker keeps only error lines and the last 3 lines and relies on the log
for the rest.
