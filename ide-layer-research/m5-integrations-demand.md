# MetaTrooper integrations: plugging into many tools cheaply

Written 2026-10-09T18:39+11:00. Repo read only at `projects/metatrooper` (main, no edits). Raw evidence files sit
next to this one: `stars.txt`, `npm.txt`, `registry-latest.json`, `cc-market.json`, `smithery.json`.

**The answer in two lines.** Most popular team tools now ship a remote (HTTP) MCP server with OAuth, and
MetaTrooper only understands local (stdio) MCP servers today. Teach the manifest one `transport: "http"` field and
let the engine do the OAuth, and about 15 of the top 25 open up at once, plus 315 Claude marketplace plugins and
roughly 13,600 registry servers.

---

## 1. What exists today

### Plugin contract and manifest

| What | Where | Note |
|---|---|---|
| Install flow: preview, permission screen, all-or-nothing approval, `manifest_hash` | `contracts/plugins.md:10-30` | Nothing runs before approval |
| Permissions: only `secrets:`, `browser`, `clipboard` enforced; `network`, `project:*` declared only | `contracts/plugins.md:32-45` | |
| DPAPI secret store, value only in the env of the one child that needs it | `contracts/plugins.md:55-65`, `core/src/secrets.ts:31` (set), `:43` (get) | |
| MCP servers reach engines through a shim; no secret in any engine config | `contracts/plugins.md:98-116`, `core/src/hook/mcp-shim.ts` (91 lines, stdio relay) | |
| Attach kinds: `claude-mcp-config-flag` and `codex-config` work; `agy-config`, `env-file`, `none` "not attached yet" | `contracts/plugins.md:108-112`, `core/src/plugins/mcp.ts:72-99` | Claude gets a per-session `--mcp-config=` file (`mcp.ts:80-88`); Codex gets `-c mcp_servers.*` args (`mcp.ts:89-95`) |
| Manifest `mcp` def is **stdio only**: `command` required, no `url`, no `transport` | `contracts/plugin-manifest.schema.json:103-115` | The gap that matters most |
| Manifest `engine` def | `contracts/plugin-manifest.schema.json:31-74` | Missing fields the built-ins use (below) |
| Action `external: true` requires `destination_field` (part of the gate hash) | `contracts/plugin-manifest.schema.json:83-90` | |
| Validator, pane-forbidden methods (`gate.resolve`, `plugin.install`, ...) | `core/src/plugins/manifest.ts:45-48`, `:106-140` | |
| Install screen facts | `core/src/plugins/manifest.ts:166-181` | |
| `plugin.source` CHECK: `native, claude-import, codex-import, agy-import, builtin` | `contracts/schema.sql:183-192` | New importers need new values |

### Importers (`core/src/plugins/importers.ts`)

| What | Line | Gap |
|---|---|---|
| `addServers`: skips any server without `command` | `:56-58` | Every `type: "http"` server is dropped |
| Claude importer reads `.mcp.json` only as `{mcpServers: {...}}` | `:117` | The official Linear plugin's `.mcp.json` is a bare map `{"linear": {"type":"http",...}}`, so it imports **zero** servers |
| Codex importer reads `[mcp_servers.*]` from `config.toml` | `:250-257` | stdio only, same skip |
| agy importer, default path unverified | `:259-269` | |
| `importFromSource`: `claude-import:`, `codex-import:`, `agy-import:` | `:272-280` | No registry or marketplace source |

Checked against the official marketplace (`anthropics/claude-plugins-official`, `cc-market.json`): the `linear`,
`github`, `context7` and `slack` plugins are all `type: "http"`. So `claude-import` of the top marketplace plugins
produces nothing usable today.

### Engine registry (`core/src/engines/registry.ts`)

| What | Line |
|---|---|
| `EngineSpec` type, including `trust`, `approval_profiles`, `ask_near_acu`, `settings`, `activity_waiting`, `print_args`, `sandbox` | `:6-29` |
| `BUILT_IN`: claude, codex, agy | `:47-77` |
| `METATROOPER_ENGINES` env override loads a JSON array of engines | `:79-83` |
| Plugin engines are rows in `engine`; `bindRole` picks lowest `cost_rank` that is installed and not red | `:85-122` |
| Spec text | `spec.md:222-235` |

Engines are already data, not code. **But** the schema's `engine` def (`plugin-manifest.schema.json:31-74`,
`additionalProperties: false`) has none of `trust`, `approval_profiles`, `print_args`, `settings`,
`activity_waiting`, `sandbox`, `ask_near_acu`. So a plugin-supplied engine can never match a built-in: no folder
trust (it will stop on its own trust dialog), no approval profiles, no headless `print_args` for pipeline steps.

### Gates, needs-you, triggers

| What | Where |
|---|---|
| Threat model: only a trusted UI connection (`ui.key`) approves | `spec.md:501-512` |
| `gate.resolve` is `needsUi`; checks `action_hash` | `core/src/methods.ts:308-325` |
| `checkApproval`: pipeline external steps need a matching approved gate, used once | `core/src/pipelines/runner.ts:979-1001` |
| `needs_you` table and kinds | `contracts/schema.sql:108-117` |
| `needs_you` rows are inserted from at least 8 places (runner, processor, store, schedules, spool, main, commands) | e.g. `runner.ts:166`, `events/processor.ts:38`, `plugins/store.ts:243`, `schedules.ts:58` |
| `run.trigger` CHECK is `manual, schedule, cli` | `contracts/schema.sql:146`, `runner.ts:72` |
| Cron scheduler on a 30 s tick | `core/src/schedules.ts:43-71`, `core/src/main.ts:114` |
| Phone and remote approval is a v3 epic (D40) | `spec.md:74`, `spec.md:1097-1101` |
| OSC 9/99/777 probe: no engine emits any | `issues/m4-06-osc-signal.md` |

### First-party plugins (`plugins/*/troop-plugin.json`)

| Plugin | Actions (external marked) |
|---|---|
| agent-reach | inspiration-board, search, sources |
| cite-check | check |
| data | load, query, render |
| deploy | preview, **production** (dest `path`) |
| desktop | screenshot, **submit** (dest `rows`), read |
| docs-export | ingest, export-pdf |
| github | **create-pr** (dest `repo`), checks, list-prs, **release** (dest `repo`) |
| gmail | read, **draft** (dest `drafts`) |
| media | probe, transcribe, download, cut, captions |
| repo | detect-tests, run-tests, diff |
| security | list-deps, licence-report |
| seo | crawl |
| social-scheduler | **schedule-post** (dest `posts`) |

None declares an `mcp` or `engines` entry. There is **no `callrouter` folder** under `plugins/`; spec.md still lists
it (`spec.md:534`) but it was renamed to toolrouter, then metarouter (`spec.md:923`), and lives outside this repo.

### Assist registry (`pipelines/assists/registry.json`)

18 helper tools with licence, egress and detect command. Four are MCP: `context7` (`:38`), `chrome-devtools-mcp`
(`:53`), `talk-to-figma` (`:85`), plus `playwright` as npm (`:43`). Context7 is installed with
`claude mcp add` (`:41`), outside the plugin system.

---

## 2. Demand ranking: top 25

Signals, in order of trust: npm weekly downloads (fetched 2026-10-09 from `api.npmjs.org`), PyPI weekly
(`pypistats.org`), GitHub stars (`gh api`), presence in the official Claude marketplace (315 entries) and in rival
desks, then upvotes on rival desks' issues. The MCP registry has **no install counts**, so npm is the proxy.
Smithery `useCount` is Smithery-reported and skews to consumer tools (Brave 87,579, Gmail 57,738); used only as a
tie-breaker.

| # | Tool | Kind | Evidence | How it is served |
|---|---|---|---|---|
| 1 | GitHub | team tool, MCP | `github/github-mcp-server` 33,462 stars; official marketplace `github`; Cursor and Devin trigger from GitHub; VK "auto-import GitHub issues" 9 votes (BloopAI/vibe-kanban#1677) | remote `https://api.githubcopilot.com/mcp/` with `Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}`; MetaTrooper already has a `github` plugin over `gh` |
| 2 | Playwright MCP | MCP | `@playwright/mcp` 6,678,981/wk; 37,950 stars; marketplace `playwright` | stdio npm |
| 3 | OpenCode | engine | `opencode-ai` 3,070,494/wk; `anomalyco/opencode` 212,261 stars; supported by Conductor and Vibe Kanban; orca#9307 16 votes, cmux#896 15 | CLI, `OPENCODE_CONFIG_CONTENT` env for MCP |
| 4 | Slack | team tool | marketplace `slack` (official `slackapi`); `@modelcontextprotocol/server-slack` 88,513/wk; Smithery 12,110; Cursor and Devin start agents from Slack | remote `https://mcp.slack.com/mcp`, OAuth |
| 5 | Linear | team tool | `@linear/sdk` 2,743,162/wk; registry `app.linear/linear`; marketplace `linear`; Cursor `@cursor` in Linear; Devin Linear trigger; VK#2159 7 votes | remote `https://mcp.linear.app/mcp`, OAuth |
| 6 | Jira / Confluence (Atlassian) | team tool | `mcp-atlassian` 159,297/wk on PyPI, 5,982 stars; registry `com.atlassian`; marketplace `atlassian`; orca#1310 "JIRA integration" 11 votes; Devin Jira trigger | remote `https://mcp.atlassian.com/v2/mcp`, OAuth; or stdio PyPI with token |
| 7 | GitHub Copilot CLI | engine | `@github/copilot` 1,552,279/wk; Vibe Kanban supports it; VK#865 | CLI, `COPILOT_HOME` holds `mcp-config.json` |
| 8 | Chrome DevTools MCP | MCP | `chrome-devtools-mcp` 1,023,240/wk; 53,154 stars; in assists registry | stdio npm |
| 9 | Context7 | MCP | `@upstash/context7-mcp` 703,440/wk; 62,822 stars; marketplace `context7`; in assists registry | remote `https://mcp.context7.com/mcp`, or stdio npm |
| 10 | pi coding agent | engine | `@mariozechner/pi-coding-agent` 629,122/wk; `earendil-works/pi` 113,647 stars; orca#13185 19 votes; cmux#4955 7 | CLI |
| 11 | Notion | team tool | `@notionhq/notion-mcp-server` 164,134/wk; registry `com.notion/mcp`; marketplace `notion` | remote `https://mcp.notion.com/mcp`, OAuth |
| 12 | Gemini CLI | engine | `@google/gemini-cli` 378,433/wk; 107,266 stars; Vibe Kanban supports it | CLI, `settings.json` `mcpServers`; no per-launch override found, verify |
| 13 | Sentry | MCP | `@sentry/mcp-server` 102,729/wk; marketplace `sentry`; Devin lists Sentry | remote OAuth, or stdio npm |
| 14 | Microsoft Teams | team tool | no MCP signal; Teams is the default chat for Windows-first companies; O365 connectors are being retired for Workflows webhooks (learn.microsoft.com, "Webhooks and connectors") | outbound webhook (Workflows "When a Teams webhook request is received") |
| 15 | Discord | team tool | marketplace `discord` (a Claude channel plugin); Smithery 82; orca#9871 asks for webhook/ntfy/Telegram channels | outbound webhook |
| 16 | ntfy (phone push) | team tool | `binwiederhier/ntfy` 34,700 stars, Apache-2.0; orca#9871 3 votes; orca#24932 and #20706 (phone push not firing); VK#1110 webhook notifications 5 votes | outbound HTTP POST |
| 17 | Postgres / Supabase / Neon | MCP | `@modelcontextprotocol/server-postgres` 97,848/wk; `@supabase/mcp-server-supabase` 68,266/wk; marketplace `supabase`, `neon`; registry `com.neon/mcp` (header auth) | stdio npm and remote |
| 18 | Figma | MCP | `GLips/Figma-Context-MCP` 15,967 stars, `figma-developer-mcp` 79,495/wk; registry `com.figma.mcp/mcp`; marketplace `figma` | remote `https://mcp.figma.com/mcp`, OAuth |
| 19 | GitLab | team tool | registry `com.gitlab/mcp`; marketplace `gitlab`; VK#1697 "self-hosted GitLab" 26 votes (2nd most-voted VK issue) | remote `https://gitlab.com/api/v4/mcp`; `glab` CLI |
| 20 | Vercel | MCP | registry `com.vercel/vercel-mcp`; marketplace `vercel`; MetaTrooper `deploy` plugin is Vercel CLI | remote `https://mcp.vercel.com`, OAuth |
| 21 | Stripe | MCP | `stripe/ai` 1,865 stars, `@stripe/mcp` 21,341/wk; registry `com.stripe/mcp`; marketplace `stripe` | remote `https://mcp.stripe.com` |
| 22 | Cloudflare | MCP | registry `com.cloudflare.mcp/mcp` (15 remote endpoints, header auth); marketplace `cloudflare`; npm stdio only 2,262/wk | remote |
| 23 | Qwen Code | engine | `@qwen-code/qwen-code` 89,018/wk; 28,370 stars; Vibe Kanban supports it | CLI (Gemini CLI fork) |
| 24 | Cursor CLI (`cursor-agent`) | engine | Conductor and Vibe Kanban support it; orca#15718, cmux#7453 | CLI, `.cursor/mcp.json` |
| 25 | Amp / Kiro / Droid | engines | Amp `@sourcegraph/amp` 26,289/wk, in Vibe Kanban; Kiro VK#1708 11 votes, cmux#2312 6; Droid VK#1004 6 | CLIs |

Left out on purpose:
- **Aider** (`aider-chat` 55,940/wk on PyPI, 49,430 stars): last push 2026-05-22, no MCP, one vote in VK#149.
- **Goose** (55,095 stars): PyPI `goose-ai` 49/wk is noise because it ships binaries; only 2 votes (VK#2162).
  Cheap to add as data later; it has `--with-extension` and `--with-streamable-http-extension`.
- **Cline CLI** (`cline` 74,522/wk): mostly the VS Code extension; no desk asks for it.
- **Agent Client Protocol** (`agentclientprotocol/agent-client-protocol` 4,394 stars): a chat protocol; MetaTrooper
  runs real terminals, so it is not the engine mechanism. Watch it.

What rival desks integrate, for context:

| Desk | Engines | Team tools |
|---|---|---|
| Conductor | Claude Code, Codex, Cursor, OpenCode | GitHub PRs |
| Vibe Kanban (28,299 stars) | Claude Code, Codex, Gemini CLI, Copilot, Cursor CLI, OpenCode, Qwen Code, Amp, Droid, CCR | GitHub; GitLab and Linear/Jira are top asks |
| Cursor cloud agents | Cursor | Slack, GitHub, Bitbucket, Linear triggers; MCP |
| Devin | Devin | Slack, Jira, Linear triggers; MCP marketplace (Sentry, Datadog, PagerDuty, Notion, Confluence) |
| cmux (28,043), Orca (88,149), Superset (15,013) | many CLIs | top asks are Windows (cmux#1012 50 votes, superset#2692 14), Jira (orca#1310 11), notification channels |

Windows demand on rival desks is itself evidence: cmux "Please bring a windows version" 50 votes, Superset 14.

### Scale of what one generic mechanism reaches

From the official MCP registry (paged 2026-10-09, `version=latest`, first 20,000 entries; the registry has more):

| Shape | Count |
|---|---|
| remote only | 12,513 |
| package only | 6,177 |
| both | 1,108 |
| package types | npm 4,504, pypi 2,114, oci 486, mcpb 452, nuget 65, cargo 26 |
| packages with a secret env var | 3,173 |
| remotes that declare headers | 3,305 |

Working: 12,513 + 1,108 = 13,621 servers have a remote, which is 68% of 20,000. Today MetaTrooper can run none of
them. Smithery lists 25,728+ servers on its home page. The official Claude marketplace has 315 plugins
(sources: `url` 164, `git-subdir` 98, in-repo 53).

---

The five mechanisms this ranking led to are the issue files `issues/m5-12` to `issues/m5-16`.
