# Plugin contract

Version 1. MIT-licensed, together with `plugin-manifest.schema.json`, so plugins can be written under any
licence.

## Manifest

`troop-plugin.json` at the plugin root, validated against `plugin-manifest.schema.json`.

## Install

1. Source: a local folder, or a git URL cloned into `~/.metatrooper/plugins/<id>/`.
2. The manifest is validated. The install screen lists every permission in plain words, every action marked
   `external`, every engine added and every MCP server added. The user approves or cancels. Approved
   permissions are stored in `plugin.permissions`; a later version asking for more permissions needs approval
   again.
3. Nothing from the plugin runs before approval.
4. The workbench and the CLI call `plugin.preview` to draw the install screen, then `plugin.install` with the
   permissions the user approved (all of them; approval is all or nothing), the preview's `manifest_hash`
   (so what installs is what was shown) and any secret values typed on the screen. A git source is cloned
   into a staging folder under `~/.metatrooper/plugins/` for each call and moved to `<id>/` on install.
5. An importer is a source too: `claude-import:<plugin folder>`, `codex-import:<config.toml>[;project=<dir>]`,
   `agy-import:<mcp_config.json>[;project=<dir>]`. Its plugin folder is `~/.metatrooper/plugins/<id>/`, holding
   the generated `troop-plugin.json` and `import.json` (source, original path, and for each env key either
   `dpapi` or the `${VAR}` name; never a value).
6. A secrets permission with no value after install raises a `missing-secret` needs-you item
   "set <NAME> for <plugin>", resolved by `plugin.secret.set` (`troop plugin secret <id> <NAME>`).
7. `plugin.remove` deletes the plugin's engines, `engine_check` rows, secrets and, when it lives under
   `~/.metatrooper/plugins/`, its folder. An engine a session or step still names keeps its row, and the
   plugin row stays with `enabled = 0`; engines of disabled plugins are never bound, checked or launched.

## Permissions

| Permission | What it grants | Enforced how (version 1) |
|---|---|---|
| `project:read` | read the project folder | cwd is the project; declared only |
| `project:write` | write in the project folder | declared only |
| `run:write` | write in the run directory | cwd and `TROOP_RUN_DIR` |
| `network` | outbound network | declared only; the install screen warns it is not blocked |
| `secrets:<NAME>` | receive environment variable `<NAME>` | **enforced**: the action's environment contains only these |
| `browser` | drive browser panes through the core | **enforced**: pipe checks pane ownership |
| `clipboard` | write to the clipboard | **enforced**: the pane bridge refuses otherwise |

"Declared only" means the user sees it at install, but Windows does not block it in version 1. OS-level
filesystem and network sandboxing (AppContainer) is out of scope for this epic and stated as such at install.

## Actions: process contract

- Started with `child_process.spawn(argv[0], argv.slice(1), {cwd, env, windowsHide: true})`. No shell.
- `env` is built from scratch: `PATH`, `PATHEXT`, `COMSPEC`, `SYSTEMROOT`, `WINDIR`, `TEMP`, `TMP`,
  `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TROOP_RUN_DIR`, `TROOP_PROJECT_DIR`, `TROOP_PLUGIN_DIR`,
  `TROOP_CHROME`, `TROOP_PDFTOTEXT`, `TROOP_WHISPER`, `TROOP_WHISPER_MODEL` when set, plus each approved `secrets:<NAME>` value. Nothing else from the parent environment is passed, except
  on Windows, where libuv copies `HOMEDRIVE`, `HOMEPATH`, `LOGONSERVER`, `SYSTEMDRIVE`, `USERDOMAIN` and
  `USERNAME` from the parent into every child (`required_vars` in libuv `src/win/process.c`).
- Secret values: entered once by the user on the install screen (or migrated by an importer, below) and stored
  encrypted with Windows DPAPI for the current user at `~/.metatrooper/secrets/<plugin>/<NAME>.dpapi`,
  recorded in `plugin_secret`. No plain-text secret is ever written by MetaTrooper.
  - Encrypt: the core runs `powershell -NoProfile -NonInteractive -Command -` with the script on stdin and the
    value in the environment variable `TROOP_SECRET_IN` of that one child process:
    `ConvertTo-SecureString -String $env:TROOP_SECRET_IN -AsPlainText -Force | ConvertFrom-SecureString`.
    Stdout (the DPAPI blob) is written to the `.dpapi` file. The value never appears on a command line or on disk.
  - Decrypt: the same way, with the blob path in `TROOP_SECRET_IN`:
    `$s = Get-Content -Raw -LiteralPath $env:TROOP_SECRET_IN | ConvertTo-SecureString; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))`,
    and the value is read from stdout into memory. Decrypted values are cached in the core's memory for the
    life of the core process and passed only through child process environments.
- stdin: one JSON object `{"schema":1,"action":<id>,"input":<with>,"project":<path>,"run":{"id","dir"}}`,
  then stdin closes.
- stdout: exactly one JSON object `{"ok":true,"outputs":{...}}` or `{"ok":false,"error":{"message":str,"retryable":bool}}`.
  Anything else on stdout fails the step with "action wrote invalid output".
- stderr: streamed line by line into the run's `log.jsonl` and the runner view, capped at 1 MB per run.
- Exit code: 0 with `ok:true` is success; anything else is failure.
- Timeout: the action's `timeout_seconds` (default 600). On timeout the whole process tree is killed with
  `taskkill /PID <pid> /T /F` (on other platforms the action runs in its own process group, which is killed).
- `argv[0]` with a slash is a path inside the plugin folder; a bare name is looked up on the stripped `PATH`
  with `PATHEXT`. A `.js`, `.mjs` or `.cjs` file runs through the core's `node`. An npm `.cmd` shim is unwrapped
  to its target; any other `.cmd` or `.bat` runs through `COMSPEC /d /s /c`, with the manifest's fixed
  arguments only (input goes through stdin, never the command line).
- `input_schema` is checked before the action starts and `output_schema` after it ends; a mismatch fails the
  step.

## Panes: the bridge

Plugin panes are served from a custom protocol, `troop-plugin://<plugin id>/<path>`, registered by the
workbench, and load `entry` in an iframe with `sandbox="allow-scripts"` (no `allow-same-origin`, so the pane
cannot touch the workbench's storage). Because a sandboxed frame has an opaque origin, `'self'` would match
nothing; the policy names the scheme origin explicitly:
`default-src troop-plugin://<plugin id> data:; connect-src 'none'`. They talk to the workbench only by `postMessage`:

| Message from pane | Reply | Needs permission |
|---|---|---|
| `{type:"read", query:"runs"|"run"|"board"|"steps", id?}` | rows as JSON | none (same project only) |
| `{type:"command", method, params}` | the pipe reply | method must be in the manifest's `pane_methods` |
| `{type:"clipboard.write", text}` | `{ok}` | `clipboard` |
| `{type:"open", url}` | `{ok}` | none; opens in the system browser after the navigation allowlist check |

Every message carries `plugin_id` and the workbench checks the sender frame belongs to that plugin.

## MCP servers from plugins and imports

Engines never receive a plugin's MCP server command directly. Their MCP configuration points at a shim:
`node <core>/mcp-shim.js <plugin id> <server id>`. The shim asks the core over the pipe for the server's
command, args and resolved secrets (DPAPI values and `${VAR}` references resolved from the user's environment
at that moment), then spawns the real server with that environment and relays stdio. No secret is written into
any engine's config file.

An `mcp` entry may also set `env`, literal non-secret values added to the server's environment (a key also in
`env_keys` is refused). In `args`, the exact token `{{cwd}}` becomes the shim's working directory, which is the
agent session's cwd; there is no other templating.

An `mcp` entry with `transport: "http"` has a `url` (https only) instead of a `command`. `auth` is `none`,
`engine-oauth` (the engine runs the sign-in and keeps the token) or `header`. `headers` maps a header name to a
value that must contain at least one `${SECRET}`; each `SECRET` needs `secrets:SECRET` in `permissions`, and a
literal header value fails validation. `writes` is `none`, `project` or `external`; an http server with no
`writes` counts as `external`.

Claude gets `{"type":"http","url":...}` in the per-session file, plus `headersHelper` (the quoted node and shim
paths, then `headers <plugin id> <server id>`) when the server has `headers`. The shim's `headers` subcommand
prints the resolved headers as JSON from the secret store and exits 1 naming any missing secret. Codex gets
`-c mcp_servers.<name>.url=<url>` only for a `writes: none` server with no `headers`. Neither is attached for agy.

A `writes: external` server is never attached to a pipeline-step session, and in an interactive session only when
the approval profile is not `contained` or `isolated` (the engine still asks per tool). Because the attach rule
already guarantees this, there is no Claude PreToolUse deny for it.

How engines are pointed at the shim (child #13):

| `mcp_attach.kind` | How |
|---|---|
| `claude-mcp-config-flag` | the core writes `~/.metatrooper/mcp/<session id>.json` with one shim entry per server and adds `--mcp-config <file>`; each launch deletes the files of sessions that have exited |
| `codex-config` | `-c mcp_servers.<plugin>-<server>.command=<node>` and `-c ...args=[<shim>, <plugin>, <server>]` per server; `config.toml` is not edited |
| `agy-config`, `env-file`, `none` | not attached yet |

If a secret is missing (no DPAPI blob, or a `${VAR}` not set), the shim does not start the server; it answers
the MCP `initialize` request with an error naming the missing variable and exits. The agent session keeps
working without that server, and the core raises a needs-you item "set <NAME> for <plugin>".

## Importers

Importers read other tools' configs and create a plugin record with `source` set to the importer. They are
read-only on the original files and follow an allowlist:

| Imported | Becomes | Rule |
|---|---|---|
| Claude Code `.claude-plugin/plugin.json` `mcpServers` | MCP entries attached to Claude sessions | `command` and `args` copied. Each `env` key becomes a `secrets:<KEY>` permission the user must approve. A literal value in the original config is migrated into the DPAPI store on approval (so the import keeps working); a `${VAR}` reference is resolved from the user's environment at launch. No value is written to a MetaTrooper file in plain text |
| Claude Code skills | skills available to engines that support skills | files referenced by path, not copied |
| Claude Code hooks | not imported | hooks run arbitrary commands on every tool call; the install screen lists them and says to install them through Claude Code itself |
| Codex and agy MCP entries | MCP entries attached to those engines | same env and migration rule as Claude |
| `.agents/skills` | skills | by path |
| `claude-marketplace:<owner/repo>[#<plugin>]` (source `marketplace-import`) | a Claude Code plugin from that repo's `.claude-plugin/marketplace.json` | the plugin is fetched at its listed `sha` (`url`, `git-subdir` with `path`, `github`) or taken from the marketplace commit (in-repo path) into `~/.metatrooper/plugins/.sources/<sha>`, then imported as a Claude plugin. An entry with no 40-character `sha` is refused. Without `#<plugin>` a marketplace with more than one plugin fails and lists them. Hooks are not imported |
| `registry-import:<name>[;file=<saved response>]` (source `registry-import`) | MCP entries for every engine (`engines: ["*"]`) from the exact-name match of `GET https://registry.modelcontextprotocol.io/v0/servers?search=<name>&version=latest` | stdio packages: `npm` to `npx -y <id>@<version>`, `pypi` to `uvx <id>==<version>`, `oci` to `docker run -i --rm -e <KEY>... <image>` only when Docker is on PATH; `mcpb`, `nuget` and other types are skipped and listed. A missing or `latest` version is skipped, so `@latest` is never generated. Secret or required env vars become `env_keys` and `secrets:<NAME>`; other env vars with a `default` become `env`. `streamable-http` remotes become `transport: http`, `writes: external`; each header becomes a `${NAME}` template (`{var}` placeholders in its value, else the header name upper-cased) with `secrets:NAME`, so `auth: header`, else `engine-oauth`. `sse` remotes are skipped |

An import from the catalogue writes `origin` in `import.json`: `{"kind": "registry" or "marketplace", "name", "version", "sha"}`
(`sha` is empty for the registry). An update is a re-import of the same name, with a fresh permission screen when
permissions grow.

An imported plugin shows its source and the original file path in the plugin list.

Importer details: a Claude plugin's servers come from `plugin.json` `mcpServers` (inline, or a path to a JSON
file) and from `.mcp.json` at the plugin root; `${CLAUDE_PLUGIN_ROOT}` in `command` and `args` becomes the
plugin folder. Only stdio servers (with a `command`) are imported; the rest are listed as skipped. An env value
that is exactly `${VAR}` or `${VAR:-default}` is a reference; anything else is a literal. An env key that is not
an upper-case name cannot become a permission and fails the import. The agy config path defaults to
`~/.gemini/antigravity-cli/mcp_config.json`, which is not verified against a real agy install yet.
