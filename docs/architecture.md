# CallRouter architecture

Holds under either plan in `spec.md`. Plan A builds the core, the store and one adapter.
Plan B adds the rest without changing the shape.

Python plus FastMCP. Chosen over TypeScript because the surrounding vault tracks 217 `.py`
files and effectively no TypeScript, and the code has to be defensible by hand.

## Four layers, one rule

**All logic lives in `core/`, which knows nothing about any host. Adapters translate, they
never decide.**

That rule is what makes Codex and Gemini support a translation job rather than a rewrite.
It exists because of a discovery made late: only Claude Code has hooks. Codex exposes
`codex mcp` and Antigravity exposes `agy mcp`, both MCP only. So MCP is the portable spine
and hooks are an accelerator available on exactly one host. Building on hooks as the
foundation would have stranded two thirds of the target surface.

| Layer | Responsibility | Knows about |
|-------|----------------|-------------|
| Adapters | Translate a host's call format to and from `CallRequest` and `Decision` | One host each, no routing logic |
| Core engine | The decision pipeline: purity, affordance, breaker, cache, template, rewrite | Nothing host-specific |
| Store | SQLite in WAL mode. Tools, calls, templates, cache entries | Schema only |
| Catalog | Shipped, versioned knowledge of popular CLIs and MCP servers | Static data, no runtime state |

## Module layout

```
callrouter/
  core/                 host-agnostic, the only place with decisions
    engine.py             the pipeline below, returns one Decision
    shapes.py             call normalisation -> shape_key
    purity.py             cacheable / mutating / external / destructive
    rank.py               the score formula
    templates.py          promote, supersede, prune
    cache.py              lookup, store, invalidate
    failures.py           affordance, breaker, remediation, cascade
  store/
    schema.sql
    db.py                 WAL mode, concurrent writers
  catalog/
    catalog.py            loader, version check, update
    data/clis/*.json
    data/mcp/*.json
  adapters/
    claude_hook.py        PreToolUse and PostToolUse
    mcp_server.py         FastMCP: search_tools, call_tool, tool_stats
    codex.py              registration helper for `codex mcp`
    agy.py                registration helper for `agy mcp`
  eval/
    replay.py             record and replay harness
  cli.py
```

Plan A needs `core/engine.py`, `core/shapes.py`, `store/`, `adapters/claude_hook.py`,
`eval/replay.py` and `cli.py`. The rest is Plan B.

## The two interfaces everything passes through

```python
@dataclass(frozen=True)
class CallRequest:
    tool_name:   str
    tool_input:  dict
    tool_use_id: str
    project_id:  str          # git toplevel, else hash of cwd
    agent_id:    str          # main session or subagent
    cwd:         str

@dataclass
class Decision:
    action: Literal["pass", "rewrite", "cache_hit", "deny", "substitute"]
    updated_input:  dict | None = None
    cached_result:  str  | None = None
    reason:         str  | None = None
    marker:         str  | None = None   # REQUIRED when action == "substitute"
```

`marker` is the Fallback Cascade carve-out enforced at the type level. A substitution that
cannot name what it replaced and why will not construct, so the dangerous version of that
feature is unbuildable rather than merely discouraged.

## Decision pipeline

Every intercepted call runs these in order and stops at the first one that decides. Order
is not arbitrary: safety checks precede savings, and anything that can deny runs before
anything that can rewrite.

| # | Step | Child | Can return |
|--:|------|-------|------------|
| 1 | Resolve `project_id`, normalise to `shape_key` | C1 | nothing, always continues |
| 2 | Catalog lookup: purity class and danger patterns | C12 | nothing, annotates |
| 3 | Negative affordance: known-bad parameters | C8 | `deny` |
| 4 | Circuit breaker: too many recent failures | C8 | `deny` |
| 5 | Snapshot if the call is mutating or destructive | C10 | nothing, side effect |
| 6 | Cache lookup on project, shape and invalidation key | C4 | `cache_hit` |
| 7 | Template match: is there a known better shape | C5 | `rewrite` |
| 8 | Self-healing: known failing argument pattern | C8 | `rewrite` |
| 9 | Rewrite rules: Read limit, shell output cap, argument fill | C7 | `rewrite` |
| 10 | Otherwise | | `pass` |

Under Plan A only steps 1, 9 and 10 exist. The others are no-ops that return nothing, so
the pipeline shape does not change when they arrive.

After execution the post handler writes `result_tokens`, `outcome` and `ended_at`, then
asynchronously updates the score, considers promoting a template, and populates the cache
if the purity class allows.

## Hook contract, verified

Claude Code PreToolUse supplies on stdin: `session_id`, `transcript_path`, `cwd`,
`hook_event_name`, `tool_name`, `tool_input`, `tool_use_id`.

To modify a call, print to stdout:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "updatedInput": { "command": "..." }
  }
}
```

Exit 0 with no output means no decision and normal flow. That is the required behaviour for
every tool CallRouter does not act on.

PostToolUse **cannot** rewrite a tool result. It can only add context. This is why shaping
happens by rewriting the command before it runs rather than trimming the output after.

## Store schema

```sql
CREATE TABLE tool (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('cli','mcp','builtin')),
  name          TEXT NOT NULL,
  server        TEXT,
  schema_json   TEXT,
  discovered_at TEXT NOT NULL,
  UNIQUE (kind, name, server)
);

CREATE TABLE call (
  tool_use_id   TEXT PRIMARY KEY,
  tool_id       INTEGER NOT NULL REFERENCES tool(id),
  session_id    TEXT,
  agent_id      TEXT,
  project_id    TEXT,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  input_json    TEXT,
  result_tokens INTEGER,
  outcome       TEXT CHECK (outcome IN ('ok','error','empty','unknown')),
  rewritten     INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL CHECK (source IN ('live','backfill'))
);

CREATE INDEX call_tool_idx    ON call (tool_id, started_at);
CREATE INDEX call_project_idx ON call (project_id, started_at);

CREATE VIEW tool_score AS
SELECT t.id, t.kind, t.name, t.server,
       COUNT(c.tool_use_id)                                       AS calls,
       AVG(CASE WHEN c.outcome='ok' THEN 1.0 ELSE 0.0 END)        AS success_rate,
       AVG(c.result_tokens)                                       AS avg_tokens,
       AVG((julianday(c.ended_at)-julianday(c.started_at))*86400) AS avg_seconds
FROM tool t LEFT JOIN call c ON c.tool_id = t.id
GROUP BY t.id;
```

Database lives at `~/.callrouter/callrouter.db`, never inside the vault. WAL mode because
several agents, including subagents, share one instance.

## Ranking formula, Plan B only

One explainable formula, deliberately not machine learned:

```
score = 100*success_rate  -  10*log10(1 + avg_tokens)  -  5*log10(1 + avg_ms)
```

Worked example using `cat` from the measured data. success_rate 1.0, avg_tokens 993
(428,872 over 432 calls), avg_ms assumed 40:

```
score = 100*1.0 - 10*log10(1+993) - 5*log10(1+40)
      = 100    - 10*2.9974        - 5*1.6128
      = 100    - 29.974           - 8.064
      = 62.0
```

Tools with fewer than 5 recorded calls take the median score of their kind, so a newly
registered tool is neither promoted nor buried before it has evidence.

## Catalog entry format, Plan B only

```json
{
  "name": "git",
  "kind": "cli",
  "catalog_version": "2026.09",
  "purity": {
    "log": "pure", "status": "pure", "diff": "pure", "show": "pure",
    "commit": "mutating", "push": "external", "clean": "destructive"
  },
  "danger": [
    {"pattern": "clean\\s+-[a-z]*x", "level": "block",
     "why": "deletes git-ignored files, unrecoverable"},
    {"pattern": "push\\s+--force", "level": "block",
     "why": "rewrites remote history"}
  ],
  "output_shape": "text",
  "typical_tokens": 96
}
```

## Failure posture

The engine must never block a call it did not mean to block. Any unhandled exception
anywhere in the pipeline is caught at the adapter boundary, logged, and converted to
`action: "pass"` with exit 0 and no stdout.

CallRouter being broken has to be indistinguishable from CallRouter being absent. That is
acceptance criterion 6, not an aspiration.
