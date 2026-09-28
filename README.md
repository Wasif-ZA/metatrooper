# CallRouter

The agent's tool memory: one command that remembers how tools were called, reuses what
worked as recipes, returns known fixes on failure, and shrinks what it prints.

**Status: spec drafted 2026-09-28, not built.** Command only: no hooks, no skill, no caps.
Only `callrouter ingest` exists today. See `docs/spec.md`.

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
2. `docs/spec.md`, what gets built, in which order.
3. `docs/architecture.md`, how the lanes fit together; the old hook design is at the bottom.
4. `docs/benchmark.md`, Headroom against a 400 token cap on 1,028 real shell outputs.
5. `docs/ideas.md`, all 29 ideas raised and where each one landed.
6. `docs/decisions.md`, everything cut and why, tagged for revisit at v2.

## Use

```
pip install -e .
callrouter ingest                     # every transcript
callrouter ingest --since 2026-09-27  # only entries from that date on
```

Prints tool shares, image cost, shell percentiles and what each cap would save. Saves a JSON
summary to `~/.callrouter/` unless `--no-save`.
