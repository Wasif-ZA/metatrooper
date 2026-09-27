# CallRouter spec

Two plans. **Neither is chosen yet.** Read `measurement.md` first, then pick one.

Both plans start with the same twenty minute check, and that check can end the project.

## Step 0, common to both plans

Install Headroom and measure it against real usage. Apache 2.0, already compresses tool
output 60 to 95 percent, ships `headroom wrap claude`, proxy mode and an MCP server, and
bundles RTK for shell-output rewriting.

Capping shell output is worth 34.7% of all tool tokens and it is exactly Headroom's job.
If Headroom delivers it, neither plan below needs to exist.

Twenty minutes against thirty hours. Do this before anything else.

## Plan A, the evidence-led cut, 30 hours

Build only what the measurement justifies. Park everything else in `decisions.md`.

| # | Child | What | Hours |
|---|-------|------|------:|
| C1 | Foundation | SQLite in WAL mode, tool and call tables, `agent_id`, PreToolUse and PostToolUse handlers in observe-only mode, rolling per-project window, backfill from the 102 transcripts | 12 |
| C9 | Replay sandbox | Record real outcomes, replay offline. Turns 2,886 recorded shell calls into a permanent regression suite. This is what proves C7 is safe | 8 |
| C7 | Rewrite and cap | Inject `limit` on Read over 40 KB, cap shell output, rewrite bare `cat` on large files to a capped range read | 10 |
| | **Total** | | **30** |

Order is C1, then C9, then C7. C9 before C7 is the important one: replay is how you prove a
rewrite rule does not break your commands, so building the rewriting before the proof is
backwards.

**What Plan A captures:** 23% to 35% of all tool tokens, depending on cap.
**What Plan A gives up:** the differentiator. What ships is a capper, not a router, and the
sell-later story goes on hold.
**What Plan A preserves:** the call log keeps running, so in a month there is real evidence
about whether the other 146 hours are worth it.

## Plan B, the full vision, 176 hours

Everything specified before the measurement came in. Plan A's three children plus eleven
more.

| # | Child | Ideas | Hours | Measured ceiling |
|---|-------|-------|------:|-----------------|
| C1 | Foundation: store, call log, backfill, window | 4, 7, 15, 18 | 12 | enables everything |
| C2 | Registry: CLI and MCP discovery | 1, 17 | 10 | enables C3 |
| C3 | Ranking and MCP surface, plus schema pruning | 2, 3, 8, 24 | 12 | MCP is 1.71% of spend |
| C4 | Cache: purity classes and invalidation | 9, 10, 11 | 14 | **0.12%** |
| C5 | Templates: promote, supersede, prune, local labelling | 12, 13, 14, 19 | 24 | 6.0% |
| C6 | Macro synthesis | 26 | 16 | subset of C5 |
| C7 | Rewrite rules | 5, 6, 25 | 10 | **34.7%** |
| C8 | Failure intelligence | 20, 21, 22, 23 | 22 | 4.7% |
| C9 | Replay sandbox and eval | 27 | 8 | enables C7 safely |
| C10 | Snapshot and rollback, no git | 28 | 8 | safety, not tokens |
| C11 | Cross-host adapters | 17 | 10 | reach, not tokens |
| C12 | Seed catalog infrastructure | 29 | 10 | for other users |
| C13 | CLI catalog content, ~50 popular CLIs | 29 | 12 | for other users |
| C14 | MCP catalog content, public registry | 29 | 8 | for other users |
| | **Total** | | **176** | |

### Dependency graph

```
C12 Seed catalog infrastructure        (independent, ships with the package)
 +--> C13 CLI catalog content
 +--> C14 MCP catalog content
            | seeds
            v
C1 Foundation
 +--> C2 Registry ------> C3 Ranking + MCP surface ----> C11 Cross-host adapters
 +--> C9 Replay sandbox -> C7 Rewrite rules        (C9 gates C7 going live)
 +--> C4 Cache
 +--> C5 Templates -----> C6 Macro synthesis
 +--> C8 Failure intelligence
 +--> C10 Snapshot and rollback

v2 epic: Jev-powered selection   (needs C3 and C5)
v2 candidate: community leaderboard, anonymised rankings pooled across installs
```

**The case for Plan B:** the measurement covers one developer's past usage. A product
serves other people whose patterns differ, and the catalog plus ranking are the only parts
with a sellable story, so cutting them leaves nothing to sell.

**The case against:** 146 hours beyond Plan A chase a combined measured ceiling near 11%,
including 14 hours on a cache whose perfect-case ceiling is 0.12%. A second model asked to
review this adversarially returned `BUILD_MUCH_SMALLER` and rated sellability at zero
against roughly 130 entrenched competitors.

## Carve-outs, binding under either plan

**C8, Fallback Tool Cascade.** Must never substitute silently. Every substituted result
carries a marker naming the tool requested, the tool that ran, and why. Enforced by the
`Decision.marker` field being required when the action is `substitute`.

**C10, Destructive Action Rollback.** Must not touch git. Automatic git state changes are
forbidden, and `git stash` on a crash can swallow the diagnostic files needed to debug it.
Plain file copy into `~/.callrouter/snapshots/<id>/` only.

## Acceptance criteria, Plan A

1. `callrouter ingest` backfills at least 2,800 shell calls and at least 270 Read calls
   from the 102 transcripts, completing in under 60 seconds.
2. Replaying all 2,886 recorded shell commands through the rewriter leaves at least 95%
   byte identical, and zero commands fail to parse.
3. Replaying the 272 recorded Read calls with the 40 KB rule projects a drop of at least
   50% against the measured 556,028 Read tokens, excluding image blocks, which cannot be
   capped.
4. Capping shell output at 400 tokens on the recorded corpus saves within 5% of the
   predicted 666,041 tokens.
5. The PreToolUse handler returns valid JSON or empty output for every tool, at p95 under
   100 ms.
6. Injected fault: with the pre handler forced to raise on every invocation, a full session
   completes with no blocked or altered tool calls.
7. Removing the two CallRouter lines from `.claude/settings.json` restores stock behaviour,
   and nothing CallRouter wrote lives inside the vault.
8. Tests written and passing.

Criterion 6 is the real safety net. CallRouter failing must be indistinguishable from
CallRouter being absent.

## Testing

Implementation and tests are not written by the same AI. Codex writes the tests.

| Layer | What | Count |
|-------|------|------:|
| Unit | `hook.handle()` on malformed stdin, missing fields, unknown tool | +5 |
| Unit | `ingest` token accounting: image block, text block, list content, string content | +4 |
| Integration | Backfill 102 transcripts into a temp DB, assert row counts and totals | +3 |
| Integration | Replay 2,886 shell commands through the rewriter, assert 95% identity | +2 |
| E2E | Live session with hooks enabled, then again with the fault injected | +2 |

## Rollback

1. Delete the two CallRouter entries from `.claude/settings.json`. Stock behaviour returns
   next session.
2. `rm -rf ~/.callrouter/`. The database is additive and derived, rebuildable with
   `callrouter ingest`.
3. Nothing is written inside the vault, so there is no vault revert.
