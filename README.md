<p align="center">
  <img src="assets/hero.png" width="420" alt="metarouter: a line-drawn owl with headphones on a rolling ladder, filing terminal prompt cards into a card catalogue labelled metarouter">
</p>

<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a> &middot;
  <a href="#use-with-claude-code-or-codex"><strong>Use with your agent</strong></a> &middot;
  <a href="#commands"><strong>Commands</strong></a> &middot;
  <a href="#compared-to"><strong>Compared to</strong></a> &middot;
  <a href="#docs"><strong>Docs</strong></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/python-3.11%2B-3776AB" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/required%20dependencies-0-1a7f64" alt="No required dependencies">
  <img src="https://img.shields.io/badge/tested%20on-Windows-0078D4" alt="Tested on Windows">
</p>

<br>

<p align="center">
  <img src="assets/demo.gif" width="800" alt="Terminal demo: pytest -v prints a wall of output; metarouter exec prints 11 lines with the failing test and summary; metarouter search finds the img recipe; metarouter run json reads a version">
</p>

<p align="center"><i><code>pytest -v</code>: 261 lines in, 11 out, the failure kept.</i></p>

<p align="center">
  <img alt="Bar chart: raw shell output is 5.26M tokens; through metarouter exec it is 956k tokens, 81.8% less, with 99.84% of error lines kept." src="assets/bench.svg">
</p>

<br>

# metarouter routes every tool call your agent makes through what already worked.

Open-source glue between coding agents and the tools they call.

**If your agent is the _driver_, metarouter is the _GPS_: it knows the route, and it knows the potholes.**

Your agent keeps rewriting the same commands, hitting the same traps, and reading 5,000 lines
to find one error. metarouter remembers the commands that worked, attaches the fix it knows,
and hands back only the lines that matter. It looks like a command wrapper. Under the hood:
learned recipes, trap hints, output shrinking, engines, a browser and MCP, all answering in one
shape.

**Stop re-teaching your agent the same commands.**

|        | Step            | Example                                                                 |
| ------ | --------------- | ----------------------------------------------------------------------- |
| **01** | Install it      | _`uv tool install metarouter`_                                           |
| **02** | Tell your agent | _Paste [four lines](#use-with-claude-code-or-codex) into `CLAUDE.md` or `AGENTS.md`._ |
| **03** | Work as normal  | _Once a week, `metarouter learn --review` and keep what is worth keeping._ |

> [!TIP]
> **🦉 Or hand the whole thing to your agent.** Paste this into Claude Code or Codex:
>
> ```text
> Install metarouter with `uv tool install metarouter`.
> Then add the "Use with Claude Code or Codex" lines from its README to my CLAUDE.md
> (or AGENTS.md for Codex), and run `metarouter` to show me the menu.
> ```

<br>

<div align="center">
<table>
  <tr>
    <td align="center" rowspan="2"><strong>Called<br>by</strong></td>
    <td align="center" valign="top"><img src="assets/logos/claude.svg" width="32" height="32" alt="Claude Code"><br><sub>Claude Code</sub></td>
    <td align="center" valign="top"><img src="assets/logos/openai.svg" width="32" height="32" alt="Codex"><br><sub>Codex</sub></td>
    <td align="center" rowspan="2"><strong>Talks<br>to</strong></td>
    <td align="center" valign="top"><img src="assets/logos/googlegemini.svg" width="32" height="32" alt="Gemini"><br><sub>Gemini</sub></td>
    <td align="center" valign="top"><img src="assets/logos/ollama.svg" width="32" height="32" alt="Ollama"><br><sub>Ollama</sub></td>
  </tr>
  <tr>
    <td align="center" valign="top"><sub>any agent<br>with a shell</sub></td>
    <td align="center" valign="top"><sub>you, at<br>a terminal</sub></td>
    <td align="center" valign="top"><img src="assets/logos/googlechrome.svg" width="32" height="32" alt="Chrome"><br><sub>Chrome</sub></td>
    <td align="center" valign="top"><img src="assets/logos/modelcontextprotocol.svg" width="32" height="32" alt="MCP servers"><br><sub>MCP servers</sub></td>
  </tr>
</table>

<em>If it can run a shell command, it can use metarouter.</em>

</div>

<br>

## metarouter is right for you if

- ✅ Your agent writes the **same inline python** or curl command every session
- ✅ It **reads whole test logs** to find the one line that failed
- ✅ It walks into **the same trap twice**: wrong endpoint, wrong flag, wrong shell
- ✅ You run **Codex or Gemini from Claude Code** and want one answer shape back
- ✅ You start **background jobs** and forget to collect them
- ✅ You want to **see and approve** what your agent learns, not a hidden hook

<br>

## The four parts

Four things have to work for an agent to stop re-learning its tools: what worked before, what
went wrong before, how much it reads, and how every answer comes back. metarouter is built
around exactly those four.

<img src="assets/parts.png" alt="The four parts of metarouter: Recipes (what worked before), Trap hints (the known fix), Shrink (only the lines that carry the answer), One shape (every tool answers the same way).">

| Part | Built for | What it does |
| --- | --- | --- |
| **Recipes**: what worked before | The agent, every call | Saved commands with placeholders, found by plain-word search, learned from your sessions |
| **Trap hints**: the known fix | The agent, on a bad call | The fix attached to the result, and a stop after three failures in a row |
| **Shrink**: errors and last lines | Your token budget | 81.8% fewer tokens, the answer lines kept, the full log on disk |
| **One shape**: same answer everywhere | Agents and scripts | One line of JSON for an agent, readable text for a person |

<br>

## See it work

Real output, captured from the commands shown.

<table>
<tr>
<td width="50%" valign="top"><img src="assets/shot-exec.png" alt="A failing test run: 261 lines in, the failure out"><br><sub><b>A failing test run: 261 lines in, the failure out</b></sub></td>
<td width="50%" valign="top"><img src="assets/shot-hint.png" alt="A known trap: the fix comes back with the result"><br><sub><b>A known trap: the fix comes back with the result</b></sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="assets/shot-recipe.png" alt="Finding a recipe in plain words, then running it"><br><sub><b>Finding a recipe in plain words, then running it</b></sub></td>
<td width="50%" valign="top"><img src="assets/shot-menu.png" alt="The whole tool, from one bare command"><br><sub><b>The whole tool, from one bare command</b></sub></td>
</tr>
</table>

<br>

## Features

<table>
<tr>
<td align="center" width="33%" valign="top">
<h3>🧠 Learns your recipes</h3>
<code>metarouter learn</code> reads your Claude Code sessions and finds the commands your agent keeps rewriting. You approve each one.
</td>
<td align="center" width="33%" valign="top">
<h3>🩹 Remembers the traps</h3>
When a command hits a trap it knows, the result carries the fix. Three failures in a row and it says stop and read the log.
</td>
<td align="center" width="33%" valign="top">
<h3>📉 Shrinks the output</h3>
81.8% fewer tokens on 5,207 real shell outputs, keeping 99.84% of error lines, tracebacks and last lines.
</td>
</tr>
<tr>
<td align="center" width="33%" valign="top">
<h3>🔌 One answer shape</h3>
Shell, recipes, Codex, a browser and MCP servers all come back as the same short result. The full log stays on disk.
</td>
<td align="center" width="33%" valign="top">
<h3>⏳ Background jobs</h3>
Start Codex with <code>--background</code>, keep working, then collect it with <code>metarouter jobs &lt;id&gt; --wait</code> from any folder.
</td>
<td align="center" width="33%" valign="top">
<h3>🌐 Its own browser</h3>
<code>metarouter browse</code> drives Chrome directly: open, look, click, type, read, screenshot. No Playwright.
</td>
</tr>
<tr>
<td align="center" width="33%" valign="top">
<h3>🔎 Plain-word search</h3>
<code>metarouter search resize image</code> finds the recipe, so the agent stops guessing flags.
</td>
<td align="center" width="33%" valign="top">
<h3>↩️ Undo for edits</h3>
The <code>replace</code> and <code>json-set</code> recipes snapshot a file first. <code>metarouter undo</code> puts it back.
</td>
<td align="center" width="33%" valign="top">
<h3>📦 Nothing to install with it</h3>
Python 3.11+ standard library. Only the <code>img</code> recipe wants Pillow.
</td>
</tr>
</table>

<br>

## Problems metarouter solves

| Without metarouter | With metarouter |
| --- | --- |
| ❌ Every session your agent writes the same inline python to read one JSON field. | ✅ `metarouter run json package.json .version`. One line, found by search, the same every time. |
| ❌ A failing test run dumps 5,000 lines into context to show one assertion. | ✅ `metarouter exec` returns the failure and the summary. The rest is in a log file if it is needed. |
| ❌ Your agent hits the same wrong endpoint, flag or shell again, and you correct it again. | ✅ The trap is written down once. The next time, the result carries the fix. |
| ❌ The agent retries a broken command five times in a row. | ✅ After three failures in an hour, metarouter tells it to stop and read the log. |
| ❌ Codex runs in the background and nobody collects the answer. | ✅ `metarouter jobs <id> --wait` collects it from any folder, in the same shape as everything else. |
| ❌ A wrapper tool quietly rewrites commands and you cannot see what it learned. | ✅ No hook. Every recipe is a file you can read, and `learn --review` asks you first. |

<br>

## Why metarouter is different

|                                   |                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| **Learned from your sessions.**   | Recipes come from your own Claude Code transcripts, not a generic catalogue.                  |
| **Shapes, not values.**           | A learned recipe keeps the command with `{1}` placeholders, never the values you ran it with. |
| **Only a person approves.**       | `learn --review` refuses to run inside an agent.                                             |
| **The answer lines survive.**     | Error lines, tracebacks, exit codes and last lines are kept: 99.84% on 5,207 real outputs.   |
| **Nothing is thrown away.**       | Every call keeps its full output on disk; the short result names the file.                  |
| **Reversible edits.**             | Recipe writes take a snapshot first. `metarouter undo` restores it.                           |
| **No hook.**                      | It runs only when called, so it never changes how your agent works behind your back.         |

<br>

## What's under the hood

metarouter is one command with eight parts, all in the Python standard library:

```
┌──────────────────────────────────────────────────────────────┐
│                          METAROUTER                          │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │  exec and │  │  recipes  │  │ hints and │  │   learn   │  │
│  │   shrink  │  │           │  │  breaker  │  │           │  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │engines and│  │   browse  │  │    mcp    │  │  undo and │  │
│  │    jobs   │  │           │  │           │  │   ingest  │  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
└──────────────────────────────────────────────────────────────┘
        ▲              ▲              ▲              ▲
  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐
  │   Claude  │  │   Codex   │  │ you, at a │  │  scripts  │
  │    Code   │  │           │  │  terminal │  │   and CI  │
  └───────────┘  └───────────┘  └───────────┘  └───────────┘
```

### The parts

<details>
<summary>Open: what each of the eight parts does</summary>

<table>
<tr>
<td width="50%" valign="top">

**exec and shrink**: Runs the command through bash, keeps the full output in <code>~/.metarouter/logs/</code>, and hands back the error lines, tracebacks, exit code and last lines.

</td>
<td width="50%" valign="top">

**Recipes**: Named commands with <code>{1}</code> placeholders. Seeds for json, replace, find, img, page, repo and the engines, plus your own from <code>add</code> and <code>learn</code>.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Hints and the breaker**: Patterns that match a known trap and attach the fix. After three failures of the same command in an hour, it tells the agent to stop and read the log.

</td>
<td width="50%" valign="top">

**learn**: Reads your Claude Code transcripts, turns repeated commands into placeholder shapes, and queues them for <code>learn --review</code>.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**Engines and jobs**: Codex, Gemini and local Ollama models behind one recipe call. Background jobs are tracked, so nothing is left running unseen.

</td>
<td width="50%" valign="top">

**browse**: Its own Chrome driver over the DevTools pipe, standard library only. A blocked-hosts list keeps it off sites you name.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**mcp**: Lists your MCP servers and their tools in one line each, calls a tool with JSON, and searches the public MCP registry in auto mode.

</td>
<td width="50%" valign="top">

**undo and ingest**: Snapshots before every recipe write. <code>ingest</code> shows where your agent's tool tokens actually go.

</td>
</tr>
</table>

</details>

<br>

## What metarouter is not

|                               |                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| **Not a hook.**               | It never intercepts commands. The agent calls it because its instructions say to.     |
| **Not a model router.**       | It never picks which model answers. It routes tool calls: shell, recipes, engines, browser, MCP. |
| **Not a proxy.**              | It never sits between your agent and the model.                                       |
| **Not a lossless pipe.**      | The agent gets a short version. Use `--no-trunc` when every byte matters.             |
| **Not cross-platform yet.**   | Built and tested on Windows through Git Bash. See [Platforms](#platforms).            |

<br>

## Quickstart

Open source. Runs on your machine. No account.

### Install it yourself

```sh
uv tool install metarouter
# or
pip install metarouter
```

Run `metarouter` for the menu.

## Use with Claude Code or Codex

There is no hook. The agent calls metarouter because its instructions say to. Paste this into
`CLAUDE.md` (Claude Code) or `AGENTS.md` (Codex):

```markdown
## Tools
Run shell commands through metarouter.
- Look for a saved recipe first: `metarouter search <words>`, then `metarouter run <recipe> ...`.
- Anything else: `metarouter exec -- "<command>"`. Read the short result; it names the full log.
- A command that worked and will be needed again: `metarouter add <name> -- '<command, {1} for arguments>'`.
- If metarouter is missing or errors, run the plain command.
```

A person at a terminal gets readable text. An agent (`CLAUDECODE` or `AI_AGENT` set) gets one
line of JSON. `--json`, `--human` or `METAROUTER_OUTPUT` force either.

## Commands

<details>
<summary>Open: 15 commands, one per goal, and the two modes</summary>

| Goal | Command |
|------|---------|
| Run anything, get a short result | `metarouter exec -- "pytest -q"` |
| Read the whole output | `metarouter exec --no-trunc -- "<command>"` |
| Find a recipe in plain words | `metarouter search resize image` |
| See every recipe | `metarouter list` |
| Run a recipe | `metarouter run json package.json .version` |
| Keep a command that worked | `metarouter add count-lines -- 'wc -l < {1}'` |
| Check every recipe still works | `metarouter check` |
| Put back the last edit | `metarouter undo` |
| Ask Codex, wait or not | `metarouter run codex "write tests for X" --background` |
| Collect a background job | `metarouter jobs <id> --wait` |
| Drive a browser | `metarouter browse open <url>`, then `look`, `click @n`, `type @n "x"`, `read`, `shot`, `close` |
| Call an MCP server | `metarouter mcp <server> <tool> '{"a": 1}'` |
| Find an MCP server | `metarouter mcp search <words>` |
| Find recipe candidates | `metarouter learn`, then `metarouter learn --review` |
| See where your tokens go | `metarouter ingest --since 2026-09-27` |

### Two modes

- **learn** (default): only recipes you approved. `learn --review` asks yes or no for each one.
- **auto**: `metarouter mode auto` adds a catalogue of 49 popular CLI recipes, `--help` lookup
  for anything on your PATH, and live search of the MCP registry. In this mode `learn` keeps
  candidates without asking.

</details>

## How it shrinks output

<p align="center">
  <img src="assets/shrink.png" width="560" alt="A line-drawn owl at a desk turns a very long paper scroll into a short note">
</p>

<p align="center">
  <img alt="Bar chart: raw shell output is 5.26M tokens; through metarouter exec it is 956k tokens, 81.8% less, with 99.84% of error lines kept." src="assets/bench.svg">
</p>

On 5,207 Bash outputs from real Claude Code transcripts:

| Kept line | Survived |
|-----------|---------:|
| Last line of output | 4,354 / 4,357 |
| Error lines | 331 / 335 |
| Tracebacks | 133 / 133 |
| Command not found, no such file | 108 / 108 |
| Exit codes | 127 / 128 |

Tokens are estimated as characters / 4. The corpus is one person's sessions, so your number
will differ: `python bench/shrink_bench.py` reruns it on yours.

## Compared to

| | Built around | How the agent uses it | Full output |
|---|---|---|---|
| **metarouter** | Remembering how your agent calls tools: recipes, trap hints, engines | The agent calls it; no hook | Log file in `~/.metarouter/logs/` |
| [rtk](https://github.com/rtk-ai/rtk) | Compact output for many common commands | A hook rewrites Bash commands | `rtk recall` |
| [Headroom](https://github.com/headroomlabs-ai/headroom) | Compressing everything sent to the model | Proxy, library or MCP | Cached locally |

If all you want is smaller shell output with no change to how the agent works, rtk's hook is
the shorter path.

## Platforms

<details>
<summary>Open: Windows tested, macOS and Linux untested</summary>

- **Windows**: built and tested here, through Git Bash.
- **macOS and Linux**: untested. `exec` needs `bash`; `browse` is Windows only for now.
- **Engines**: `codex` needs the Codex plugin for Claude Code. `gemini` and `local` still call
  scripts from the author's own setup and are not portable yet.

</details>

## Privacy

<details>
<summary>Open: what it reads, where it writes, what leaves your machine</summary>

- `learn` and `ingest` read your transcripts in `~/.claude/projects/` and stay on your machine.
- Logs, recipes, snapshots and jobs live in `~/.metarouter/` (or `METAROUTER_HOME`).
- No telemetry. The network is used only when you ask for it: MCP registry search (auto
  mode), the `page` recipe (through r.jina.ai), `up`, `repo` (through `gh`), and the engines.

</details>

## Roadmap

- ⬜ `browse` on macOS and Linux
- ⬜ `gemini` and `local` engines that work outside the author's setup
- ⬜ Computer use: an agent cursor of its own that never takes over your mouse

## Docs

1. [`docs/measurement.md`](docs/measurement.md): where agent tokens actually go.
2. [`docs/benchmark.md`](docs/benchmark.md): the shrinker against Headroom and a plain cap.
3. [`docs/spec.md`](docs/spec.md): what gets built, in which order.
4. [`docs/architecture.md`](docs/architecture.md): how the lanes fit together.
5. [`docs/ideas.md`](docs/ideas.md): every idea raised and where it landed.
6. [`docs/decisions.md`](docs/decisions.md): what was cut and why.

Tests: `uv run --no-project --with pytest --with pillow python -m pytest -q`.
