# M4-3 `code-map` plugin and the codex review prompt

Child of Milestone 4 in `spec.md` (Milestones and child issues). Decisions M4-D1 to M4-D12 and the
verified current state are there; this file is what to build.

## What to build
- Install, documented on the plugin's install screen: `& "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe" -m pip install code-review-graph`.
  The screen also shows, in red: "Never run `code-review-graph install` or `uninstall`; they rewrite every
  agent's settings." Detection: `code-review-graph --version` exits 0 within 5 s.
- Manifest schema change (`contracts/plugin-manifest.schema.json`, `contracts/plugins.md`): an `mcp` entry
  gains `env` (object of literal, non-secret strings; a key that is also in `env_keys` is refused), and the
  shim replaces the exact token `{{cwd}}` in `args` with its own working directory, which is the agent
  session's cwd. No other templating.
- `plugins/code-map/troop-plugin.json`:
  ```json
  {"schema": 1, "id": "code-map", "version": "0.1.0", "name": "Code map",
   "mcp": [{"id": "graph", "command": "code-review-graph",
            "args": ["serve", "--repo", "{{cwd}}", "--tools", "detect_changes_tool,get_review_context_tool,query_graph_tool"],
            "env": {"PYTHONUTF8": "1"}, "engines": ["claude", "codex"]}]}
  ```
  Tool names are the ones in the code-review-graph README `--tools` example. If `tools/list` on the
  installed version lacks one, the plugin's install check fails with the missing names.
- `pipelines/code-map/index.mjs` (code step, shared): if detection fails, returns
  `{available: false, hint: "Also read the source files it touches."}` and logs `code map not installed`. Otherwise it adds `.code-review-graph/`
  to the repository's `info/exclude` (same lookup as `excludeTroop`, `runner.ts:1095`), runs
  `code-review-graph update` when `.code-review-graph/` exists and `code-review-graph build` when it does
  not, in `ctx.projectPath`, 300 s timeout, and returns `{available: true, hint: "<sentence below>"}`. A
  timeout or non-zero exit returns `{available: false, hint: "Also read the source files it touches.", reason}`; the step never fails the run.
- `pipelines/two-engine-review.json`: a new step `map` (code, `pipelines/code-map/index.mjs`, outputs
  `available`, `hint`) between `diff` and `codex-review`. The `codex-review` prompt drops "and the source
  files it touches" and ends with `{{steps.map.outputs.hint}}`. The hint sentence: "Call
  get_review_context_tool on the changed files first. Read a whole source file only when that is not
  enough, and list every whole file you read as files_read in your front matter." `files_read` is optional
  and is not added to the step's `outputs`. `gemini-review` is unchanged (M4-D12).
- Fallback: when the map is unavailable, `hint` is "Also read the source files it touches." so the rendered codex prompt keeps today's
  instruction in full. The M4-06 test asserts that sentence is in the rendered prompt file.

## Measured before building, 2026-10-09T00:54+11:00

code-review-graph 2.3.9, replay harness on the axios fixture. `get_review_context_tool` takes `changed_files` (not
`files`) and `base` (default `HEAD~1`; the replay passes `HEAD` because the patch is uncommitted).

| detail_level | small (366 before) | medium (2,820) | large (11,200) | median ratio |
|---|---|---|---|---|
| standard (default) | 2,479 | 6,846 | 27,981 | 2.48 |
| minimal | 425 | 886 | 3,890 | 0.35 |

Decided by Wasif 2026-10-09: build with `detail_level: minimal`; the real after-runs (M4-04) decide whether agents
still open whole files. The hint names the tool's arguments: `changed_files` and `detail_level: "minimal"`.

Built 2026-10-09 with two changes from the text above. The plugin lives in `plugins/optional/code-map/`,
not `plugins/code-map/`: every folder directly in `plugins/` registers as a builtin and attaches to every Claude
and Codex session, which would break sessions on machines without code-review-graph. It is installed from the
plugin screen with that folder as the source. Code steps now get `ctx.plugins` (enabled plugin ids), and the
`map` step returns the fallback hint unless `code-map` is among them, so the hint never names a tool the
session does not have.

## Acceptance criteria

- M4-05. Installing and using the code-map plugin leaves these unchanged, by SHA-256 of each file that exists
  and absence of each that does not: `~/.claude/settings.json`, `~/.claude.json`, `~/.claude/CLAUDE.md`,
  `~/.codex/config.toml`, `~/.codex/AGENTS.md`, `~/.gemini/antigravity-cli/mcp_config.json`, and in the
  project `CLAUDE.md`, `AGENTS.md`, `.mcp.json`, `.codex/`, `.cursor/`. Only `.code-review-graph/` and one
  `info/exclude` line are new.
- M4-06. With the code-map plugin removed, `two-engine-review` completes on the fixture with the fake engine
  and the `map` step output `available: false`.

## Tests

| Criterion | Test | Kind |
|---|---|---|
| M4-05 | `core/test/code-map-install.test.ts`: hash the files, install the plugin, start a fake claude session with it, hash again | integration |
| M4-06, M4-25 | `core/test/two-engine-review.test.ts` new cases | integration |

Tests by Codex. A test that needs a real external tool skips with a printed reason when it is absent.
