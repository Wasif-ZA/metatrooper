# CallRouter

The agent's tool memory: one command that remembers how tools were called, reuses what
worked as recipes, returns known fixes on failure, and shrinks what it prints.

**Status: phases 1 to 7 built 2026-09-28.** Command only: no hooks, no skill, no caps.
Run `callrouter` for the menu. See `docs/spec.md`.

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
callrouter                                   # the menu
callrouter exec -- "pytest -q"                # short result, full log kept
callrouter search resize image                  # find a recipe in plain words
callrouter list                              # every recipe, one line each
callrouter run json package.json .version     # run a recipe
callrouter run replace notes.txt old new      # snapshot first; callrouter undo puts it back
callrouter undo                              # put back the files the last write changed
callrouter add count-lines -- 'wc -l < {1}' # keep a command that worked
callrouter run gemini --dir docs "review spec.md"   # engines: codex, codex-review, gemini, local
callrouter run codex "write tests for X" --background
callrouter jobs <id> --wait                  # collect a background job from any folder
callrouter browse open https://example.com   # then look, click @n, type @n "x", read, shot, close
callrouter mcp <server> <tool> '{"a": 1}'    # servers in ~/.callrouter/servers.json
callrouter tools                             # what is used here, MCP tools in one line each
callrouter learn                             # mine the transcripts; a person runs learn --review
callrouter check                             # run every recipe's example
callrouter ingest --since 2026-09-27         # where tool-result tokens go
```

A person gets readable text. An agent (`AI_AGENT` or `CLAUDECODE` set) gets one line of JSON.
`--json` and `--human` force either. Everything callrouter writes lives in `~/.callrouter/`.
