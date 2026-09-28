# CallRouter

A registry, ranker and call router for CLI tools and MCP servers, sitting in front of an
AI coding agent's tool calls.

**Status: specified, not built. Plan not yet chosen.** See `docs/spec.md` for the two
plans on the table and pick one before writing code.

Step 0 is done. Headroom was benchmarked against 1,028 real recorded shell outputs and
saves 4.2% on this workload against 62.4% for a 400 token cap, because it declines to
compress 72% of them. It does not cover the gap, so C7 has a measured justification.
See `docs/benchmark.md`.

## The finding that shapes everything

Before building, 102 real Claude Code sessions (41,209 transcript lines) were measured to
find out where agent tokens actually go. The result contradicted the original plan.

| Where the tokens go | Share |
|---------------------|------:|
| Bash, shell and CLI output | 63.2% |
| Read, of which images are most | 29.0% |
| All MCP servers combined | 1.71% |

The project was conceived as an MCP router. MCP is 1.71% of the spend.

Measured ceilings, meaning the saving if a feature worked perfectly, before paying for any
of the logic that makes it work:

| Feature | Ceiling | Hours | Tokens per hour |
|---------|--------:|------:|----------------:|
| Cap shell output at 400 tokens | 666,041 (34.7%) | 10 | 66,600 |
| Learned call templates | 114,709 (6.0%) | 24 | 4,800 |
| Failure recovery intelligence | 89,478 (4.7%) | 22 | 4,100 |
| Result cache | 2,353 (0.12%) | 14 | 170 |

A 390x spread. The cache ceiling comes from 33 exact repeat commands out of 2,886, so a
perfect cache with zero staleness saves 0.12%. Full working in `docs/measurement.md`.

## Read in this order

1. `docs/measurement.md`, the evidence. Read this first; it is why the plans differ.
2. `docs/benchmark.md`, the Headroom comparison that settled Step 0.
3. `docs/spec.md`, the two plans and the decision still to be made.
4. `docs/architecture.md`, the design, which holds for either plan.
5. `docs/ideas.md`, all 29 ideas raised and where each one landed.
6. `docs/decisions.md`, everything cut and why, tagged for revisit at v2.

## Reproducing the benchmark

```
uv tool install headroom-ai
HEADROOM_BEACON=off DO_NOT_TRACK=1 python bench/headroom_bench.py --limit 0 --cap 400
```

Reads local transcripts only. Nothing leaves the machine; `headroom.compress()` is a
library call with no network path. The beacon flags are there because Headroom's
telemetry upload is on by default.
