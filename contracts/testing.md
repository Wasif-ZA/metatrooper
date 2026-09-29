# Testing surface for the core (child #1)

Version 1. Tests use only what this file and the other contracts expose. They never import anything else
from `core/src/`.

## Running

- Node 24.16 or later. TypeScript runs directly (type stripping); there is no build step.
- Tests live in `core/test/*.test.ts` and run with `node --test "core/test/*.test.ts"`.
- No test touches the real `~/.metatrooper`, the real pipes, `~/.claude/settings.json`, `~/.codex/config.toml`,
  or opens a Windows Terminal window.

## Isolation variables

| Variable | Default | Effect |
|---|---|---|
| `METATROOPER_HOME` | `~/.metatrooper` | data folder: `troop.db`, `ui.key`, `logs/`, `secrets/`, `worktrees/` |
| `METATROOPER_PIPE_PREFIX` | `metatrooper` | pipes become `\\.\pipe\<prefix>` and `\\.\pipe\<prefix>-browser` |
| `TROOP_LAUNCHER` | `wt` | `spawn`: `session.launch` runs `launch.js` as a hidden detached node process with no Windows Terminal (test mode) |
| `METATROOPER_CLAUDE_SETTINGS` | `~/.claude/settings.json` | file that `troop hooks install` edits |
| `METATROOPER_CODEX_CONFIG` | `~/.codex/config.toml` | file that `troop hooks install --codex` edits |
| `METATROOPER_ENGINES` | built-in registry | path to a JSON array of engine objects that replaces the built-ins (lets tests use fake engines) |
| `METATROOPER_FAKE_DPAPI` | unset | `1` on a non-Windows host stores secrets as a reversible encoding instead of calling PowerShell DPAPI, so the secret paths run in Linux CI. Ignored on Windows |

`event.js` and `launch.js` honour `METATROOPER_HOME` too.

## Processes

| Command | What it does |
|---|---|
| `node core/build.ts` | generates `core/event.js`, `core/launch.js`, `core/codex-notify.js`, `core/mcp-shim.js`, `core/code-host.js`, `core/metatrooper-browser.js` and `core/dist/` from the TypeScript in `core/src/`; `--check` exits 1 if any generated file is out of date. Run once before the tests |
| `node core/src/main.ts` | starts the core service in the foreground; exits 0 on SIGINT or the `core.stop` method |
| `node core/event.js <kind> ...` | the event writer (see `events-and-hooks.md`) |
| `node core/cli.ts hooks install [--codex]` and `... hooks uninstall [--codex]` | hook installation (see `events-and-hooks.md`); `--yes` skips the confirm |
| `node core/launch.js --session <id> --engine <id> --args-b64 <b64>` | the launcher; `<b64>` is base64 of a JSON array `[command, ...args]`; exits with the command's exit code |

The core is ready when `\\.\pipe\<prefix>` answers `core.ping` with `{"ok":true}`. Two extra methods exist for
tests and tools, in addition to those in `pipe-protocol.md`:

| Method | Params | Result |
|---|---|---|
| `core.ping` | `{}` | `{ok: true, pid, schema_version}`; never queued |
| `core.stop` | `{}` | `{}`; the core finishes the current command and exits; needs `ui.hello` |

## Pure functions tests may import

| Module | Export | Contract |
|---|---|---|
| `core/src/project.ts` | `canonicalPath(p: string): string` | rules in `pipe-protocol.md`, `project.open` (no git lookup) |
| `core/src/project.ts` | `projectId(canonical: string): string` | sha1 hex of the canonical path |
| `core/src/project.ts` | `isAcuPath(p: string): boolean` | true when the path contains `work/ACU` (either slash, any case) |
| `core/src/redact.ts` | `redactToolInput(toolName: string, input: unknown): object` | the table in `events-and-hooks.md` |
| `core/src/redact.ts` | `buildPayload(kind: string, raw: object): object` | the allowlists in `events-and-hooks.md` |
| `core/src/events/state.ts` | `nextState(current: string, event: {kind: string, payload: object}): string \| null` | the state mapping table; `null` means no change |
| `core/src/pipe/framing.ts` | `encode(msg: object): string`, `createDecoder(onMessage): (chunk: Buffer \| string) => void` | newline-delimited JSON, 1 MiB line cap (over the cap: throws `LineTooLong`) |

## Plugin modules tests may import (child #3)

| Module | Export | Contract |
|---|---|---|
| `core/src/jsonschema.ts` | `validate(schema, data): string[]` | the JSON Schema 2020-12 keywords the contracts use; errors read `<pointer>: <message>` |
| `core/src/plugins/manifest.ts` | `validateManifest(manifest, dir \| null): string[]` | schema errors, then duplicate ids, `env_keys` without `secrets:<KEY>`, forbidden `pane_methods`, paths outside the plugin |
| `core/src/plugins/actions.ts` | `runAction(req): Promise<{ok, outputs} \| {ok, error}>`, `BASE_ENV` | the action process contract in `plugins.md`; never rejects |
| `core/src/plugins/bridge.ts` | `paneCsp(id)`, `resolvePaneFile(dir, urlPath)`, `checkPaneMessage(plugin, framePluginId, msg)` | the pane bridge in `plugins.md` |
| `core/src/plugins/importers.ts` | `importClaude(dir)`, `importCodex(file, project?)`, `importAgy(file?, project?)`, `parseToml(text)` | the importer table in `plugins.md`; literal values stay in memory |
| `core/src/plugins/mcp.ts` | `mcpAttachArgs(db, engine, sessionId): string[]` | engine arguments pointing plugin MCP servers at the shim |
| `core/src/engines/registry.ts` | `bindRole(db, role, pinned?)` | lowest `cost_rank` engine listing the role, installed and not red |

## Pipeline modules tests may import (child #4)

| Module | Export | Contract |
|---|---|---|
| `core/src/pipelines/validate.ts` | `validatePipeline(json, ctx): string[]`, `isGuarded(step, ctx)` | `pipelines.md`, Validation; `ctx` is `{pipeline(id), action(pluginId, actionId), dir}` |
| `core/src/pipelines/template.ts` | `parseRef`, `resolveString`, `canonicalJson`, `actionHash`, `parseFrontMatter` | the template grammar in `pipeline.schema.json`; the hash in `pipelines.md`, Gates |
| `core/src/ports.ts` | `leasePort(db, runId, idx)`, `releasePorts(db, runId, idx?)` | `pipelines.md`, Fan-out |

Everything else about runs is observable through the pipe (`run.*`, `gate.resolve`, `variant.*`,
`pipeline.validate`) and the `run`, `run_step`, `gate`, `variant`, `browser_pane`, `dev_server` and
`port_lease` tables. A fake engine (`METATROOPER_ENGINES`, `TROOP_LAUNCHER=spawn`) that reads the handoff
footer from its last argument and writes the output file is enough to drive every step kind.

## Browser modules tests may import (child #6)

| Module | Export | Contract |
|---|---|---|
| `core/src/browser/policy.ts` | `checkUrl(url, {ownedPorts, allowHosts, lookup?}): Promise<{allow} \| {allow, reason}>`, `blockedAddress(addr)` | `browser-tools.md`, safety rule 2; pass a `lookup` to fake DNS |
| `core/src/browser/ancestry.ts` | `parentTable()`, `ancestors(pid, table?)` | up to 8 parents |

The tools, ownership and interception are observable end to end with the workbench running under a display
(`xvfb-run` on Linux): a fake engine that starts `core/metatrooper-browser.js` as its child and speaks MCP on
its stdio drives only its own pane. `METATROOPER_WORKBENCH_PROBE` also receives `{kind: "cursor", target, at}`
before every click, `{kind: "click"}`, and `{kind: "blocked", url, reason}` for every refused request.
