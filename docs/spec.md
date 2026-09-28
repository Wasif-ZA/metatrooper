# CallRouter spec

**Drafted 2026-09-28.** Replaces the 2026-09-27 Plan A. The old decision is summarised under
History at the bottom; the full text is in git.

## What it is

One command, `callrouter`, that an agent or a person runs. It is the agent's tool memory, and
the glue between coding agents: Codex, Gemini, the local models and every repeated script
all go through it and come back as the same clean JSON.

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
| `callrouter exec -- <cmd>` | Runs any shell command, logs it, prints the shrunk result |
| `callrouter run <recipe> [args]` | Runs a saved recipe |
| `callrouter search <words>` | Finds recipes by plain words, ranked, with arguments and an example |
| `callrouter list` | Every recipe, one line each |
| `callrouter add <name> -- <cmd>` | Saves a command that just worked as a recipe |
| `callrouter learn` | Mines the Claude Code transcripts for recipe and hint candidates |
| `callrouter learn --review` | Human-only: approve or reject candidates |
| `callrouter check` | Re-runs every recipe's example and reports pass or fail |
| `callrouter undo [snapshot]` | Puts back the files the last write recipe changed |
| `callrouter browse <verb>` | Drives a browser (phase 6) |
| `callrouter jobs [id] [--wait]` | Lists and waits on background engine jobs (phase 3) |
| `callrouter tools`, `callrouter mcp` | Lists and calls CLI and MCP tools (phase 7) |
| `callrouter ingest` | The existing token measurement, unchanged |

The verbs are copied from tools that do the same job, checked with `gh` on 2026-09-28: `run` a
named task and `exec` a raw command as in mise (34k stars), `search` as in just (36k), atuin
(32k) and pet, `add` as in `mise tasks add`, `list` as in pet and `just --list`. The first
draft used `do`, `how` and `save`, which no comparable tool uses.

Recipe arguments are positional, in the order a person would say them:
`callrouter run replace <file> <old> <new>`.

## Output contract

Every command follows the same contract, whoever runs it.

**Who is asking.** Checked in this order, first match wins:

1. `--json` or `--human` flag.
2. `CALLROUTER_OUTPUT=json` or `human` in the environment.
3. `AI_AGENT` or `CLAUDECODE` set: JSON. Claude Code sets both (probed 2026-09-28).
4. Otherwise: human text.

A terminal check (`isatty`) is not used. Under Git Bash it reports "not a terminal" even when
a person is typing, so it would hand JSON to a human.

**Agent form.** Exactly one compact JSON line, with only what the agent needs:

```json
{"ok":true,"exit":0,"out":"1.4.2","log":"C:/Users/User/.callrouter/logs/2026-09-28/0957-812-json.log"}
```

- Always: `ok`, `exit`, `out`, and `log` whenever one was written.
- Only when the output was shrunk: `errors`, `more_errors`, `tail`, `lines`.
- Only when present: `hint`, `breaker`, `note`, `fallback`, `marker`.
- Never: `lane`, `cmd`, `recipe`, `secs`, `bytes`. The agent typed the command, so echoing it
  back costs tokens and says nothing. The call log still records all of them.

Measured 2026-09-28 in two real sessions (50 callrouter calls): the old envelope carried about
55 tokens on every result, and on short outputs that was more than the output itself. In one
session the callrouter results cost 3,219 tokens against 2,718 tokens of raw output. The lean
envelope is about 25 tokens, most of it the log path.

**Human form.** The same facts as readable text: a tick or cross, the recipe, the short
result, and the log path.

**Rules for both:**

- The exit code is the underlying command's exit code.
- Errors name the exact next command, for example
  `no recipe "jsn". Did you mean: callrouter run json <file> <path>`.
- The full raw output is written to the log before anything is shrunk. The log is byte for
  byte what the command printed.
- If a shrinker crashes, callrouter prints the raw output and the real exit code. A broken
  callrouter must behave like a plain shell, never like a silent one.

## Shrinking

Chosen by what the output looks like, not by which tool made it.

| Kind | What is kept |
|------|--------------|
| Text | Line and byte count, every line matching an error pattern, repeats counted once, up to 40 with a count of the rest (the benchmark smart cap's limit), the last 3 lines. Lines clipped at 300 characters, the needle length limit |
| JSON | The shape: top-level keys, list lengths, the first 3 items |
| Image | Resized to 784 px on the long edge. This is `hook.py`'s `shrink_image`, reused |
| Page (browse) | Title, headings, numbered links, buttons and fields |

Short output (under 2,000 characters) is printed whole. Shrinking only kicks in above that.

Keeping every error line comes from `benchmark.md`: Headroom's protected error output,
copied into a 400 token cap, cost 2,106 tokens (62.4% saved instead of 62.6%) and raised
needle survival from 98.8% to 99.0%.

## Recipes

The five seed recipes are built into the package (`callrouter/recipes/`), so they update with
it. Saved and learned recipes are one JSON file each in `~/.callrouter/recipes/<name>.json`,
and a file wins over a seed of the same name.

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

- `kind` is `python`, `shell`, `engine`, `browse` or `mcp`. A shell recipe's body is a command template
  with `{placeholders}`.
- `purity` is `read`, `write`, `external` or `destructive`. A destructive recipe will not run
  without `--yes`.
- `source` is `seed`, `learned` or `saved`.
- A Python recipe returns its own compact answer, which is not passed through the text
  shrinker. When the answer is an object or a list it sits in `out` as real JSON, not as a
  string. A shell recipe's output goes through the shrinker like `run`.
- An example carries `setup` (files to create), `args`, `expect_exit` and `expect_out`. `check`
  runs each one in a temporary folder with a temporary callrouter home, so checks never touch
  real files or the call log.
- Success rate, token size and speed are not stored in the recipe. They are computed from the
  call log, so they never go stale.
- Saving a recipe under a name that already exists moves the old one to
  `~/.callrouter/recipes/archive/<name>@<n>.json`. `check` flags recipes unused for 60 days.

### The five seed recipes

Written fresh from the group names in `measurement.md`. Nothing is copied from any transcript.

| Recipe | Replaces | Built-in traps |
|--------|----------|----------------|
| `replace <file> <old> <new>` | 461 file-edit scripts | UTF-8 in and out, line endings kept; snapshot first; reports how many matches changed; `--old-file` and `--new-file` for text with backslashes or newlines |
| `json <file> <path>` | 425 JSON-read scripts | Stands in for `jq`, which this laptop does not have; paths like `.a.b[0]` |
| `json-set <file> <path> <value>` | 90 read-and-write scripts | UTF-8; snapshot first; keeps key order |
| `img <info\|shrink\|diff> <file> [file2]` | 302 image scripts | Reuses `shrink_image`; `diff` reports changed area and percentage |
| `find <pattern> <folder>` | 175 regex-search scripts | Grouped by file with counts; skips `.git`, `node_modules`, `.venv` |

Passing arguments on the command line avoids the heredoc escaping trap entirely.

### `search` ranking

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
with no `--add-dir`. `run` and `run` check the command against those before running and put
the warning in `hint`. The call still runs. It never blocks.

**Breaker.** When the same recipe or binary has failed 3 times in a row within an hour, the
result carries a `breaker` note with the last error. It warns; it never blocks. Refusing a
call the agent chose is the one thing callrouter must not do.

**Marked substitution, binding.** If a recipe falls back to a different tool (for example
`browse read` falling back to a plain fetch), the result must carry a `marker` naming the
tool asked for, the tool that ran, and why. The result builder refuses a fallback with no
marker, so a silent substitution cannot be built.

Built 2026-09-28 (`callrouter/hints.py`): ten seed hints, six checked before the run and
four on a failed call's output. `~/.callrouter/hints.json` adds hints and overrides a seed by
`id`. The breaker key is the recipe name, or the first word of the command shape for `run`.

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

Built 2026-09-28 (`callrouter/learn.py`). Thresholds: a shape becomes a recipe candidate at 5
uses with 80% success (3 uses for shapes from the call log). File plumbing (`ls`, `cat`, `grep`
and the like) and inline Python never become shell recipes. A hint candidate needs a failed
call whose output names an error kind, followed within 3 calls by a different shape of the same
binary that worked. A rejected candidate is remembered in `candidates/rejected.json` and not
offered again. First run on 506 transcripts: 42 recipe and 41 hint candidates, 11 seconds.

## Agent glue, phase 3

callrouter is the layer between a coding agent and every other engine it calls: Codex,
Gemini through `agy`, the local models, and the plain scripting around them. Whatever
runs underneath, the caller gets the same clean result.

**Why.** This vault already has three separate wrappers doing this job:
`codex-companion.mjs` for `/codex:*`, `meta/scripts/agy-run.sh` and `agy_jobs_lib.py` for
`/agy-*`, and `meta/scripts/local.sh` for `/local`. Each has its own flags, job handling and
output shape. The glue is also where calls fail: `codex-companion.mjs` fails 13% of 248
calls and `agy` 22% of 36 (`measurement.md`, 2026-09-28).

**Engines are recipes.** `kind: engine`. Each wraps the existing script, it does not
replace it, and carries its known traps:

| Recipe | Runs | Traps built in |
|--------|------|----------------|
| `run codex "<task>" [--write]` | `codex-companion.mjs task` | waits for the job; never starts one and walks away |
| `run codex-review` | `codex-companion.mjs review` | same |
| `run gemini "<question>" [--add-dir D] [--lane L]` | `meta/scripts/agy-run.sh`, lane `second-opinion` by default | refuses to run a file question with no `--add-dir`, the empty-output trap |
| `run local "<prompt>" [--model M]`, or `run local <lane> ...` | `meta/scripts/local.sh ask`, gemma4:12b by default; a first word naming a `local.sh` lane passes straight through | direct `127.0.0.1:11434` only |

Engines are called with an argument list, never a shell string, so a prompt cannot run a
second command. `NODE_NO_WARNINGS=1` keeps Node deprecation noise out of Codex answers.
`agy-run.sh`'s status footer is cut from the answer and kept in the log.

**Answers are kept whole.** An engine's answer is the output, so it does not go through the
text shrinker. Up to 8,000 characters come back in `out`; the rest is in the log. An answer
that parses as JSON comes back as a JSON object.

**One result shape.** An engine's answer comes back in the same `Result` as a shell
command: `ok`, `exit`, `out`, `errors`, `tail`, `log`. Engine output that is already JSON
(agy verdicts, the local status object) goes into `out` as JSON, not as text. The full
transcript of the engine run is in the log.

**Jobs.** Engine calls run long. `--background` starts one and returns a job id;
`callrouter jobs` lists every job from every engine; `callrouter jobs <id> --wait` blocks
until it ends and returns its result. The default is to wait. A job started in the
background is still owned by callrouter, so its result is never orphaned. `jobs` records the
folder each job started from, because `codex-companion.mjs` keeps its job list per project
folder: asking from another folder reports no such job while it is still running (hit
2026-09-28).

**Boundaries.** An external engine is an external send whatever wraps it: the ACU rule
applies to `codex` and `gemini` exactly as it does without callrouter. callrouter only
carries the calls. The two-engine audit rule is unchanged: Codex and Gemini stay two
separate calls, and callrouter never merges their verdicts.

**Inside the engines' own work.** The forwarder agents (`gemini`, `codex:codex-rescue`, the local
ones) stay as they are. What changes is the engine at the far end: while Codex or Gemini does a
job, it uses callrouter as its tool, reads the JSON, evaluates, and finishes the job.

```
Claude -> gemini / codex forwarder (unchanged) -> Gemini / Codex
                                                   | during the job:
                                                   |   callrouter --json exec -- "pytest -q"
                                                   |   callrouter --json run find <regex> <folder>
                                                   v
                                    evaluates, finishes, returns to Claude
```

- **Codex** reads `~/.codex/AGENTS.md` on every run. It tells Codex to use `exec`, `run json`,
  `run find`, `run replace`, `search` and `list`, and to fall back to plain commands when
  callrouter is missing.
- **Gemini: blocked, not wired.** Decided 2026-09-28: read-only verbs only. Tried and reverted the
  same day. `agy` checks `command(<prefix>)` allow rules, and an exact rule such as
  `command(callrouter --json list)` passes that check. The command then still needs
  `escalate_admin`, because `agy` runs commands in a sandbox and callrouter writes to
  `~/.callrouter` outside the project folder. Granting that is a sandbox escape, well beyond
  read-only. A denied command also fails the whole `agy` run, so the preamble change in
  `agy-run.sh` broke a work-lane job and was reverted with the allow rules. Gemini keeps its
  read-only file tools.
- An earlier version routed the forwarders themselves through callrouter, and a separate
  callrouter agent existed briefly. Both were undone on 2026-09-28.

## Browser, phase 6

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
  REDCap and ACU reporting hosts during phase 6, before the first `open`, so a page holding real ACU data cannot be pulled into an
  agent's context by this tool.

Built 2026-09-28 (`callrouter/browse/`). The blocked-hosts list is checked before `open` in the
CLI, and again inside the daemon after every navigation, so a click that lands on a blocked
host closes the page. A blocked host also blocks its subdomains.

## MCP and tools, phase 7

- `mcp <server> <tool> '<json args>'` calls an MCP tool over stdio with plain JSON-RPC:
  initialize, then `tools/call`. Standard library only.
- Servers are listed in `~/.callrouter/servers.json`, in the same `{"mcpServers": {name: {command,
  args, env}}}` shape Claude Code uses, so an entry can be moved across as is. Not in Claude Code's config, so their
  tool definitions never enter the context.
- `tools` prints one line per tool: the CLI binaries seen in the transcripts, and each MCP
  tool's name, arguments and first sentence. `tools <name>` prints the full definition.
- Tools that have worked in the current project are listed first (idea 24).

Low priority by design: MCP is under 1% of calls here. It matters more for Codex and
Antigravity, which do not defer tool definitions.

## Flows (multi-step recipes), v2

Decided 2026-09-28: the first v2 piece, ahead of computer use. Idea 26 (macro synthesis) and
old child C6.

A flow is a recipe with `kind: flow` whose body is a list of steps. Each step is one callrouter
command line without the `callrouter` word, and may use `{1}`..`{9}` for the flow's arguments.

```
callrouter add read-page --step "browse open {1}" --step "browse read" --summary "open a page and read it"
callrouter run read-page https://example.com
```

- Steps run in order through the same lanes as a typed command, so each keeps its own log,
  call record, hints and shrinking.
- The first failing step stops the flow. The flow's exit code is that step's exit code.
- The result's `out` is one entry per step that ran: the step as run, `ok`, `exit`, and its
  `out` or `note`.
- A step may not run another flow, so a flow cannot loop.
- `check` skips flows: their steps are checked as recipes of their own.

Later, not now: `learn` proposing flows from command sequences that always run together.

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
| C3 Ranking, schema pruning | `search` ranking with the kept formula; `tools` one-liners |
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
| 2 | Recipe format, five seed recipes, `run`, `search`, `add`, `check`, snapshots | 1 |
| 3 | Agent glue: codex, gemini and local as engine recipes, one result shape, `jobs` | 2 |
| 4 | Hints seeded from gotchas, breaker, marker | 1 |
| 5 | `learn` and `learn --review` | 2, 4 |
| 6 | `browse`: daemon, CDP over pipe, look, click, type, read, shot | 1 |
| 7 | `mcp` and `tools` | 1 |
| v2a | Flows: multi-step recipes (built 2026-09-28) | 2 |
| v2 | Computer use, Jev-powered selection, community catalog | |

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
16. With calls logged in two projects, `search` ranks by the current project's calls first.
17. An engine recipe returns the same result fields as `run`, and a background job's result
    can always be fetched with `callrouter jobs <id> --wait`, even after the caller exited.

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
