# M5-14 Engines as data: schema parity and an engine pack

Child of Milestone 5 in `spec.md` (Milestone 5: launch). Decisions M5-D1 onward and the launch scope are
there; this file is what to build. Tag: done in code 2026-10-09 (M5-D8 revised). Source: the integrations scan of 2026-10-09 (registry, npm,
PyPI and rival-desk evidence, ranked list in `ide-layer-research/m5-integrations-demand.md`).

The after-launch parts of this file are a design sketch, not a build spec: before building, it is re-specced and
scored by the Codex gate like every M4 child.

**Unlocks:** #3 OpenCode, #7 Copilot CLI, #10 pi, #12 Gemini CLI, #23 Qwen Code, #24 Cursor CLI, #25 Amp, Kiro,
Droid. Later Goose.

**How.** The registry already treats engines as data (`registry.ts:79-122`). The block is the schema. Add the
fields the built-ins already use, and three generic MCP attach kinds that cover the CLIs checked:

| CLI | Per-launch MCP hook found | Attach kind |
|---|---|---|
| OpenCode | `OPENCODE_CONFIG_CONTENT` env (opencode.ai/docs/config) | `env-json` |
| Copilot CLI | `COPILOT_HOME` dir holds `mcp-config.json` (docs.github.com) | `config-dir` |
| Goose | `--with-extension "<name>:<cmd>"`, `--with-streamable-http-extension <url>` | `args-template` |
| Gemini CLI, Qwen Code | `settings.json` `mcpServers`; no per-launch override found | `none` at launch; verify |
| Cursor CLI, Amp, Kiro, Droid | not checked | `none` at launch |

Ship engine files under `engines/<id>.json`, loaded like `BUILT_IN`, and installable as a plugin with only an
`engines` entry.

**What a data-only engine gets, plainly:** installed and version lights, auth light when it has an auth command,
launch in a core-owned terminal, resume when `resume_args` is known, MCP when an attach kind fits. Needs-you
detection is best effort (`process`, or `file-activity` with a glob) unless the CLI has hooks. No engine emits OSC
notifications (`issues/m4-06-osc-signal.md`), and cmux#896 shows OpenCode does not either.

**Files to change**

- `contracts/plugin-manifest.schema.json:31-74` (`engine` def)
- `core/src/engines/registry.ts:79-83`: load `engines/*.json` after `BUILT_IN`
- `core/src/plugins/mcp.ts:72-99`: the three new attach kinds
- `core/src/trust.ts`: reuse as is (already data-driven by `TrustSpec`)
- `spec.md:222-235` engine table

**Manifest addition** (inside `$defs.engine`):

```json
{
  "trust": { "type": "object", "required": ["kind", "file", "at", "path_style"],
    "properties": { "kind": { "enum": ["json-map", "json-list", "toml-table"] }, "file": { "type": "string" },
      "at": { "type": "array", "items": { "type": "string" } }, "set": { "type": "object" },
      "path_style": { "enum": ["posix", "windows", "windows-lower"] } } },
  "approval_profiles": { "type": "object", "propertyNames": { "enum": ["ask", "edits", "contained", "isolated"] },
    "additionalProperties": { "type": "array", "items": { "type": "string" } } },
  "print_args": { "type": "array", "items": { "type": "string" }, "description": "Headless run; {prompt} is replaced." },
  "activity_waiting": { "type": "object", "required": ["last_line_regex"],
    "properties": { "file": { "type": "string" }, "last_line_regex": { "type": "string" } } },
  "settings": { "type": "object", "required": ["file", "set"] },
  "ask_near_paths": { "type": "boolean" },
  "mcp_attach": { "properties": {
    "kind": { "enum": ["claude-mcp-config-flag", "codex-config", "agy-config", "env-json", "config-dir", "args-template", "none"] },
    "env": { "type": "string", "description": "env-json: variable that receives the JSON. config-dir: variable that receives the folder." },
    "format": { "enum": ["mcpServers", "opencode-mcp"], "description": "Shape of the JSON written." },
    "template": { "type": "array", "items": { "type": "string" }, "description": "args-template: per server; {name}, {node}, {shim}, {plugin}, {server}, {url}." }
  } }
}
```

`sandbox` stays built-in only (it describes the trooper sandbox host, `spec.md:549`).

**Security rules**

- `approval_profiles` for `isolated` is shown on the install screen in red words ("this engine will act without
  asking").
- `env-json` and `config-dir` hold shim commands only; same "no secret in engine config" rule.
- `trust.file` and `settings.file` must be under the user's home, and the existing trust writer's byte-identical
  uninstall applies.
- An engine from a plugin starts with `cost_rank` at least 5 until the user lowers it, so `bindRole` never silently
  prefers an unknown engine.

**Effort:** 3 CC days (schema parity 0.5, loader 0.25, attach kinds 1, four engine files with real checks 1,
tests 0.25). Each further engine file: about 0.25.

**Acceptance tests**

- M5-14a: every `BUILT_IN` entry validates against the `engine` def (today it would fail on `trust`).
- M5-14b: `engines/opencode.json` validates; `engines.check` shows it green when `opencode` is on PATH and red when not.
- M5-14c: launching opencode with one plugin MCP server sets `OPENCODE_CONFIG_CONTENT` to JSON holding only the shim
  command; the user's own `opencode.json` is unchanged byte for byte.
- M5-14d: a plugin engine with no `cost_rank` override never wins `bindRole` over a built-in for the same role.

## As built (2026-10-09)

- `engines/opencode.json`, `copilot.json`, `gemini.json`, `pi.json`, loaded after `BUILT_IN` by `dataEngines` in
  `core/src/engines/registry.ts`; attach kinds `env-json`, `config-dir`, `args-template` in `core/src/plugins/mcp.ts`
  write shim commands only; tests `core/test/m5-engines.test.ts`.
- A malformed or schema-invalid engine file is skipped with a warning, never stops the core.
- Every data or plugin engine starts at cost_rank 5 or more; a tie goes to the built-in; a plugin cannot take an
  engine id a built-in or another plugin already holds.
- Not yet: Qwen Code, Cursor CLI, Amp, Kiro, Droid, Goose engine files (about 0.25 CC days each).
