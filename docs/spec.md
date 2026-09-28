# CallRouter spec

**Drafted 2026-09-28.** Replaces the 2026-09-27 Plan A. The old decision is summarised under
History at the bottom; the full text is in git.

## What it is

One command, `callrouter`, that an agent or a person runs. It is the agent's tool memory.

It does four jobs:

1. **Remember.** Every call made through it goes into a call log.
2. **Reuse.** Calls that work become named recipes. The agent runs a recipe instead of
   writing the same script again.
3. **Recover.** When a call fails, a known fix comes back in the same result.
4. **Shrink.** The result that gets printed is short. The full output is always saved to a
   log file, so nothing is lost.

It is only a command. No hooks, no skill, no output caps, no Claude Code setting. Claude Code
runs exactly as it does without it. Because it is a plain command, Codex, Antigravity and a
human terminal can all use it with no adapter.

## Why

From `measurement.md`, 2026-09-28 section:

- Bash is 57% of all tool calls. MCP is under 1%.
- Agents wrote 2,592 throwaway Python scripts. About 60% of them are five jobs: edit a file,
  read JSON, handle an image, regex search, read and write JSON.
- A few tools fail often: `agy` 22%, `sleep` 14%, `node` 13%. Most of those failures are
  known traps already written down in `meta/gotchas.md`.

So the biggest win is not smaller output. It is the agent not re-deriving the same working
call every session.

## Commands

| Command | What it does |
|---------|--------------|
| `callrouter` | Prints a menu of about 10 lines: the verbs and the most-used recipes |
| `callrouter run -- <cmd>` | Runs any shell command, logs it, prints the shrunk result |
| `callrouter do <recipe> [args]` | Runs a saved recipe |
| `callrouter how <words>` | Finds recipes by plain words, ranked, with arguments and an example |
| `callrouter save <name> -- <cmd>` | Saves a command that just worked as a recipe |
| `callrouter learn` | Mines the Claude Code transcripts for recipe and hint candidates |
| `callrouter learn --review` | Human-only: approve or reject candidates |
| `callrouter check` | Re-runs every recipe's example and reports pass or fail |
| `callrouter browse <verb>` | Drives a browser (phase 5) |
| `callrouter tools`, `callrouter mcp` | Lists and calls CLI and MCP tools (phase 6) |
| `callrouter ingest` | The existing token measurement, unchanged |

Recipe arguments are positional, in the order a person would say them:
`callrouter do replace <file> <old> <new>`.

## Output contract

Every command follows the same contract, whoever runs it.

**Who is asking.** Checked in this order, first match wins:

1. `--json` or `--human` flag.
2. `CALLROUTER_OUTPUT=json` or `human` in the environment.
3. `AI_AGENT` or `CLAUDECODE` set: JSON. Claude Code sets both (probed 2026-09-28).
4. Otherwise: human text.

A terminal check (`isatty`) is not used. Under Git Bash it reports "not a terminal" even when
a person is typing, so it would hand JSON to a human.

**Agent form.** Exactly one JSON line:

```json
{"ok": true, "lane": "do", "recipe": "json", "exit": 0, "secs": 0.1,
 "out": "\"1.4.2\"", "errors": [], "tail": [], "log": "~/.callrouter/logs/2026-09-28/0957-json.log",
 "hint": null, "breaker": null, "marker": null}
```

**Human form.** The same facts as readable text: a tick or cross, the recipe, the short
result, and the log path.

**Rules for both:**

- The exit code is the underlying command's exit code.
- Errors name the exact next command, for example
  `no recipe "jsn". Did you mean: callrouter do json <file> <path>`.
- The full raw output is written to the log before anything is shrunk. The log is byte for
  byte what the command printed.
- If a shrinker crashes, callrouter prints the raw output and the real exit code. A broken
  callrouter must behave like a plain shell, never like a silent one.

## Shrinking

Chosen by what the output looks like, not by which tool made it.

| Kind | What is kept |
|------|--------------|
| Text | Line and byte count, every line matching an error pattern (never dropped), the last 3 lines. Lines clipped at 200 characters. Grown from `run.py`'s `summarise`, which today keeps only 5 error lines |
| JSON | The shape: top-level keys, list lengths, the first 3 items |
| Image | Resized to 784 px on the long edge. This is `hook.py`'s `shrink_image`, reused |
| Page (browse) | Title, headings, numbered links, buttons and fields |

Short output (under 2,000 characters) is printed whole. Shrinking only kicks in above that.

Keeping every error line comes from `benchmark.md`: Headroom's protected error output,
copied into a 400 token cap, cost 2,106 tokens (62.4% saved instead of 62.6%) and raised
needle survival from 98.8% to 99.0%.

## Recipes

One JSON file per recipe in `~/.callrouter/recipes/<name>.json`.

```json
{
  "name": "replace",
  "summary": "find and replace text in a file, literal or regex",
  "args": ["file", "old", "new", "--regex", "--from-file"],
  "kind": "python",
  "body": "callrouter.recipes.replace",
  "purity": "write",
  "example": {"args": ["demo.txt", "cat", "dog"], "expect_exit": 0},
  "source": "seed"
}
```

- `kind` is `python`, `shell`, `browse` or `mcp`. A shell recipe's body is a command template
  with `{placeholders}`.
- `purity` is `read`, `write`, `external` or `destructive`. A destructive recipe will not run
  without `--yes`.
- `source` is `seed`, `learned` or `saved`.
- Success rate, token size and speed are not stored in the recipe. They are computed from the
  call log, so they never go stale.
- Saving a recipe under a name that already exists moves the old one to
  `~/.callrouter/recipes/archive/<name>@<n>.json`. `check` flags recipes unused for 60 days.

### The five seed recipes

Written fresh from the group names in `measurement.md`. Nothing is copied from any transcript.

| Recipe | Replaces | Built-in traps |
|--------|----------|----------------|
| `replace <file> <old> <new>` | 461 file-edit scripts | UTF-8 in and out; snapshot first; reports how many matches changed; `--from-file` for patterns with backslashes |
| `json <file> <path>` | 425 JSON-read scripts | Stands in for `jq`, which this laptop does not have; paths like `.a.b[0]` |
| `json-set <file> <path> <value>` | 90 read-and-write scripts | UTF-8; snapshot first; keeps key order |
| `img <info\|shrink\|diff> <file> [file2]` | 302 image scripts | Reuses `shrink_image`; `diff` reports changed area and percentage |
| `find <pattern> <folder>` | 175 regex-search scripts | Grouped by file with counts; skips `.git`, `node_modules`, `.venv` |

Passing arguments on the command line avoids the heredoc escaping trap entirely.

### `how` ranking

Substring match over name, summary and argument names. Ranked with the formula kept from the
2026-09-27 architecture:

```
score = 100*success_rate - 10*log10(1 + avg_tokens) - 5*log10(1 + avg_ms)
```

Recipes with fewer than 5 logged calls take the median score, so a new recipe is neither
buried nor promoted before there is evidence.

Ranking is per project first (idea 15). Scores are computed from the calls made in the
current project; a recipe with no calls here falls back to its score across all projects.

## Call log

`~/.callrouter/calls.jsonl`, one line per call: time, project, agent, lane, recipe or command
shape, exit code, seconds, output bytes, log path.

- `project` is the git root, else a hash of the working folder (idea 15).
- `agent` is `CLAUDE_CODE_SESSION_ID` when set, else `human`. Several agents share one log
  (idea 18), so each append takes a lock file (`calls.jsonl.lock`) and writes the line in a
  single call. Windows does not promise that two appends at once stay on separate lines. Shape only: quoted strings and numbers are replaced by
placeholders before writing. JSON lines, not SQLite: append-only, readable, and nothing needs
a query engine yet.

## Failure hints and the breaker

**Hints.** `~/.callrouter/hints.json` holds pairs of an error pattern and a fix. When a call
fails, the output is matched against them and the fix goes into `hint`.

Seeded by hand from the tool traps in `meta/gotchas.md`, rewritten as short rules. Examples:
`agy` returned nothing: add `--add-dir <folder>`. Ollama returned empty content: use
`/api/generate` with `"think": false`. `UnicodeDecodeError` or `charmap`: pass
`encoding="utf-8"`.

**Before the run (idea 20).** Some hints also carry a command pattern, for example `agy`
with no `--add-dir`. `run` and `do` check the command against those before running and put
the warning in `hint`. The call still runs. It never blocks.

**Breaker.** When the same recipe or binary has failed 3 times in a row within an hour, the
result carries a `breaker` note with the last error. It warns; it never blocks. Refusing a
call the agent chose is the one thing callrouter must not do.

**Marked substitution, binding.** If a recipe falls back to a different tool (for example
`browse read` falling back to a plain fetch), the result must carry a `marker` naming the
tool asked for, the tool that ran, and why. The result builder refuses a fallback with no
marker, so a silent substitution cannot be built.

## `learn`

Reads `~/.claude/projects/**/*.jsonl`, the same files `ingest` reads.

1. Groups inline scripts and shell commands by shape, as in `measurement.md`.
2. Counts uses, failures, and failed-then-fixed pairs.
3. For a failed-then-fixed pair, the difference between the two calls becomes a hint
   candidate.
4. Strips every specific: paths, quoted strings and numbers become `{placeholders}`.
5. Writes candidates to `~/.callrouter/candidates/`.

Also promotes from the call log: a command shape that succeeds 3 or more times through `run`
becomes a candidate.

**Review is human only.** `learn --review` shows each candidate and asks yes or no. It refuses
to start when `AI_AGENT` or `CLAUDECODE` is set. The agent never reads a candidate before it is
approved, because a candidate is mined from transcripts that can hold real ACU paths or
values. `learn` itself prints counts and group names only.

## Browser, phase 5

**Own driver, no dependency.** Talks to the installed Chrome over the DevTools protocol through
`--remote-debugging-pipe`. Probed 2026-09-28: `Browser.getVersion` answered from stdlib Python
on this laptop. No websocket library, no Playwright, no gstack.

**Why it needs a small background process.** Chrome's pipe belongs to the process that
started it, and each `callrouter` call exits. So the first `browse` call starts a daemon that
owns Chrome and listens on `127.0.0.1` with a random port and a token, both in
`~/.callrouter/browser.json`. Later calls talk to it. It stops after 30 idle minutes.

| Verb | What it does |
|------|--------------|
| `open <url>` | Loads a page, prints the page summary |
| `look` | Page summary: title, headings, and every link, button and field numbered `@1`, `@2`... from the accessibility tree |
| `click @n`, `type @n "text"` | Acts on a numbered element, then prints only what changed |
| `read` | Main text of the page |
| `shot [--full]` | Screenshot, shrunk to 784 px, saved to the log folder |
| `back`, `tabs`, `close` | Navigation |
| `--show` | Opens a visible window, for logging in by hand |

**Where it beats a wrapper:**

- Numbered refs come straight from the accessibility tree.
- After an action it prints only what changed, not the whole page again.
- It follows the same output contract as every other lane.
- A browse sequence can be saved as a recipe, for example a login flow.

**Safety:**

- Own profile at `~/.callrouter/chrome-profile`, never the everyday Chrome profile.
- `browse` refuses any host in `~/.callrouter/blocked-hosts.txt`. Wasif fills that file with the
  REDCap and ACU reporting hosts during phase 5, before the first `open`, so a page holding real ACU data cannot be pulled into an
  agent's context by this tool.

## MCP and tools, phase 6

- `mcp <server> <tool> '<json args>'` calls an MCP tool over stdio with plain JSON-RPC:
  initialize, then `tools/call`. Standard library only.
- Servers are listed in `~/.callrouter/servers.json`, not in Claude Code's config, so their
  tool definitions never enter the context.
- `tools` prints one line per tool: the CLI binaries seen in the transcripts, and each MCP
  tool's name, arguments and first sentence. `tools <name>` prints the full definition.
- Tools that have worked in the current project are listed first (idea 24).

Low priority by design: MCP is under 1% of calls here. It matters more for Codex and
Antigravity, which do not defer tool definitions.

## Computer use, v2

Not in v1. What is decided now:

**Goal.** The agent has its own cursor and does ordinary desktop tasks without taking over
the person's mouse.

**Constraint.** Windows has one real pointer. "Own cursor" can mean either:

- a separate session (a second desktop, a VM, or a loopback remote session) where the agent
  has a real pointer of its own; or
- acting on a target window through UI Automation and window messages, without moving the
  real pointer, plus a drawn overlay cursor that shows where it is acting.

The mechanism is picked in the v2 spec, after v1 ships.

**Privacy.** Screenshots enter the model's context. The screen lane is never run while REDCap,
filled partner reports or participant records are on screen. The tool cannot detect that, so
the person decides before running it.

## What came from the 2026-09-27 plan

| Old child | Where it lives now |
|-----------|--------------------|
| C1 Foundation | JSONL call log; `learn` is the backfill |
| C2 Registry | `tools`, seeded from binaries seen in the transcripts |
| C3 Ranking, schema pruning | `how` ranking with the kept formula; `tools` one-liners |
| C4 Cache | Still cut. Ceiling 0.12% |
| C5 Templates | Recipes, with promote, supersede and prune kept |
| C6 Macro synthesis | Multi-step recipes, v2 |
| C7 Rewrite rules | Shrinkers after the run. Nothing is rewritten before it runs |
| C8 Failure intelligence | Hints, warn-only breaker, marked substitution |
| C9 Replay sandbox | `callrouter check` re-runs each recipe's example |
| C10 Snapshot, no git | `replace` and `json-set` copy files to `~/.callrouter/snapshots/<id>/` first. Never git |
| C11 Cross-host adapters | Free. A command works in every host |
| C12 to C14 Catalog | Seed is the five recipes plus gotcha hints; community catalog is v2 |

Also kept: purity classes (now recipe metadata), and the failure posture (broken must look
like absent).

## Build order

Each phase is usable on its own.

| Phase | What | Needs |
|------:|------|-------|
| 1 | Output contract, call log, `run` (from `run.py`), the menu, logs under `~/.callrouter/logs/` | nothing |
| 2 | Recipe format, five seed recipes, `do`, `how`, `save`, `check`, snapshots | 1 |
| 3 | Hints seeded from gotchas, breaker, marker | 1 |
| 4 | `learn` and `learn --review` | 2, 3 |
| 5 | `browse`: daemon, CDP over pipe, look, click, type, read, shot | 1 |
| 6 | `mcp` and `tools` | 1 |
| v2 | Computer use, multi-step recipes, Jev-powered selection, community catalog | |

## Acceptance criteria

1. With `AI_AGENT` or `CLAUDECODE` set, every command prints exactly one line of valid JSON.
   With neither set and no flag, no command prints JSON.
2. Every lane writes the full raw output to a log, and the result names that log. The log's
   bytes equal the command's output.
3. With a shrinker forced to raise, the command still prints the raw output and returns the
   real exit code.
4. `callrouter`'s exit code equals the underlying command's exit code.
5. The five seed recipes correspond to the five largest groups `learn` reports on the corpus
   at build time.
6. `replace` and `json-set` snapshot before writing; restoring the snapshot gives back the
   original bytes.
7. `learn --review` refuses to run when an agent variable is set. No candidate becomes a recipe
   without a yes.
8. A result that names a fallback tool without a marker cannot be constructed.
9. `browse` refuses every host in `blocked-hosts.txt` and never opens the everyday Chrome
   profile.
10. Nothing callrouter writes lives in the vault or in a project folder; everything is under
    `~/.callrouter/`.
11. `callrouter check` runs every recipe's example and reports each one as pass or fail.
12. The call log holds shapes only: no quoted string or number from a command appears in it.
13. Needle survival: on the recorded shell corpus used by `bench/headroom_bench.py`, the text
    shrinker keeps at least 99% of needles (tracebacks, `error:` and `fatal:` lines, exit
    codes, the last non-empty line), measured with that harness's matching rule.
14. Two processes appending 1,000 lines each to the call log at once leave 2,000 lines that
    each parse as JSON.
15. A command matching a pre-run hint pattern returns that hint and still runs.
16. With calls logged in two projects, `how` ranks by the current project's calls first.

## Testing

Implementation and tests are not written by the same AI. Codex or Gemini writes the tests.
Fixtures are synthetic transcripts and synthetic files built by the tests, because real
transcripts can hold material that must not leave this laptop.

Run with `uv run --no-project --with pytest --with pillow python -m pytest -q`.

## Rollback

1. `pip uninstall callrouter`.
2. `rm -rf ~/.callrouter/`. The call log and summaries are derived; recipes the person
   approved are the only thing lost, so back up `recipes/` first if they matter.

No Claude Code setting is touched, so there is nothing to restore there.

## History

- **2026-09-27, Plan A.** Built `callrouter ingest`. Shipped a Bash output cap
  (`BASH_MAX_OUTPUT_LENGTH=2000`) and a Read hook (`hook.py`: shrink screenshots, add
  `limit: 300` to big text reads). Headroom was benchmarked first (`benchmark.md`): 4.2%
  saved against 62.4% for a 400 token cap, so it was not the answer. A 100k auto-compact cap was tried and removed on
  2026-09-28. The context-size model is kept in `measurement.md`.
- **2026-09-28.** Cap and hook unhooked from `~/.claude/settings.json`. Direction changed to a
  command-only tool memory, tailored from the transcripts. `hook.py` stays as the source of
  the image shrinker.
