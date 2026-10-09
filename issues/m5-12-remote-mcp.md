# M5-12 Remote MCP servers (`transport: "http"`)

Child of Milestone 5 in `spec.md` (Milestone 5: launch). Decisions M5-D1 onward and the launch scope are
there; this file is what to build. Tag: BLOCKER (ships 2026-12-01). Source: the integrations scan of 2026-10-09 (registry, npm,
PyPI and rival-desk evidence, ranked list in `ide-layer-research/m5-integrations-demand.md`).

**Unlocks:** #1 GitHub, #4 Slack, #5 Linear, #6 Atlassian, #9 Context7, #11 Notion, #13 Sentry, #17 Neon and
Supabase remote, #18 Figma, #19 GitLab, #20 Vercel, #21 Stripe, #22 Cloudflare. 13 of the 25.

**How, per engine.** Not one flat rule, because the engines differ.

| Engine | No-auth or OAuth server | Header-auth server (token in DPAPI) |
|---|---|---|
| claude | add `{"type":"http","url":...}` to the per-session file `mcp.ts:80-88` already writes. Claude Code runs the OAuth itself and keeps the token; MetaTrooper never sees it | same entry plus `"headersHelper": "<node> <shim> headers <plugin> <server>"`. Claude Code runs it at connect time and on a 401/403 retry (code.claude.com/docs/en/mcp, v2.1.195+). The shim prints `{"Authorization":"Bearer ..."}` from DPAPI to stdout. No value in any file |
| codex | `-c mcp_servers.<n>.url="..."`. Codex runs its own MCP OAuth (`mcp_oauth_callback_port` in the Codex config reference) | **not at launch.** `bearer_token_env_var` would put the token in Codex's process environment, which every shell command the agent runs inherits. That breaks the rule that a secret lives only in the one child that needs it. Waits for the shim relay (below) |
| agy | not attached; `agy-config` is still unbuilt (`plugins.md:112`) | not attached |

**Shim relay (post-launch).** Teach `mcp-shim.ts` to speak stdio to the engine and streamable HTTP to the server
(POST JSON-RPC, read a JSON or SSE reply, carry `Mcp-Session-Id`). That gives Codex header-auth, and puts every
tool call through MetaTrooper, which is what per-tool gating needs. No `mcp-remote` dependency: 1,620 stars fails
the 25k gate, and the relay is the shim's job anyway.

**Files to change**

- `contracts/plugin-manifest.schema.json:103-115` (`mcp` def), `contracts/plugins.md:98-116`
- `core/src/plugins/manifest.ts`: `McpSpec` type (`:19-25`); `validateManifest` rule that each `${NAME}` in
  `headers` has `secrets:NAME`; `installScreen` shows the host and "sign-in handled by <engine>"
- `core/src/plugins/mcp.ts:72-99`: emit http entries; skip header-auth servers for codex with a needs-you note
- `core/src/hook/mcp-shim.ts`: `headers` subcommand (prints JSON, exits); relay later
- `core/src/plugins/importers.ts:56-58`: keep http servers instead of skipping them
- `core/src/hook/` Claude PreToolUse handling: deny rule below

**Manifest addition** (inside `$defs.mcp`; `command` stops being required):

```json
{
  "transport": { "enum": ["stdio", "http"], "default": "stdio" },
  "url": { "type": "string", "pattern": "^https://" },
  "headers": {
    "type": "object",
    "additionalProperties": { "type": "string", "pattern": "^[^$]*(\\$\\{[A-Z][A-Z0-9_]{0,63}\\}[^$]*)+$" },
    "description": "Each value must contain at least one ${SECRET}. Literal values fail validation."
  },
  "auth": { "enum": ["none", "header", "engine-oauth"], "default": "none" },
  "writes": {
    "enum": ["none", "project", "external"],
    "description": "external: the server can post, send, create or spend outside the machine. Default external for anything imported with a remote."
  }
}
```

with `"allOf": [{"if": {"properties": {"transport": {"const": "http"}}}, "then": {"required": ["url"]}, "else": {"required": ["command"]}}]`.

**Security rules**

1. No secret value in any engine config file. OAuth tokens stay inside the engine's own store; header values go
   through `headersHelper` only.
2. **The gate hole, named.** `checkApproval` (`runner.ts:979-1001`) gates pipeline steps only. A Linear
   `create_issue` call from inside a session goes engine to vendor with MetaTrooper not involved, and under the
   `isolated` approval profile the engine asks nothing. So:
   - A server with `writes: "external"` is **never attached to a pipeline-step session.** A pipeline that posts to
     Slack or creates an issue uses a plugin action with `external: true`, which the existing gate covers.
   - In interactive sessions it attaches only under approval profiles where the engine still asks per MCP tool
     (not `contained`, not `isolated`). The person answering the engine's prompt in the workbench terminal is the
     approval.
   - Claude belt and braces: MetaTrooper already installs Claude hooks (`state_source: hooks`). Its PreToolUse
     handler denies `mcp__<plugin>-<server>__*` for `writes: external` servers when the session belongs to a
     pipeline run.
   - Codex: no verified per-tool control at launch, so it gets only `writes: none` remote servers until the relay.
3. The install screen lists each remote host under `network` and says which engine holds the sign-in.
4. Engines store OAuth tokens keyed by server name, so the name must never change between launches. It is already
   stable: `<plugin>-<server>` from `entriesFor` (`mcp.ts:65`). First sign-in has to happen in an interactive
   session, because a headless pipeline step cannot finish an OAuth browser flow. That is a second reason for
   keeping `writes: external` servers out of pipeline sessions.

**Effort:** 3 CC days (schema and validator 0.5, Claude http and headersHelper 1, Codex url 0.5, PreToolUse deny
0.5, tests 0.5). Shim relay later: 3 CC days.

**Acceptance tests** (next to `core/test/*.test.ts`)

- M5-12a: `validateManifest` rejects `headers: {"Authorization": "Bearer abc"}` (a literal) and accepts
  `"Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}"` only with `secrets:GITHUB_PERSONAL_ACCESS_TOKEN`.
- M5-12b: launch a claude session with a header-auth plugin; the per-session JSON has `type: "http"`, a
  `headersHelper`, and no byte of the secret (grep the file for the stored value: zero hits).
- M5-12c: run the `headersHelper` command; stdout parses as `{"Authorization":"Bearer <value>"}`; with the secret
  missing it exits non-zero and a `missing-secret` needs-you row appears. Two traps: Claude runs the helper
  string through a shell, so the node and shim paths must be quoted (spaces under `Program Files`); and the
  helper has a 10 s timeout, while the DPAPI decrypt starts a PowerShell child, so the test times a cold run and
  must finish under 10 s.
- M5-12d: a codex session gets `-c mcp_servers.<n>.url=...` for an `engine-oauth` server and no entry for a
  `header` server.
- M5-12e: a pipeline-step session never receives a `writes: external` server, under every approval profile.
