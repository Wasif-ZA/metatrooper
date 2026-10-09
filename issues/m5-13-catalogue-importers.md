# M5-13 Catalogue importers: Claude marketplaces and the MCP registry

Child of Milestone 5 in `spec.md` (Milestone 5: launch). Decisions M5-D1 onward and the launch scope are
there; this file is what to build. Tag: BLOCKER for step 1 (importer shape fix, 0.5 CC days); marketplace and registry importers M5, after 12-01, M5-D8. Source: the integrations scan of 2026-10-09 (registry, npm,
PyPI and rival-desk evidence, ranked list in `ide-layer-research/m5-integrations-demand.md`).

The after-launch parts of this file are a design sketch, not a build spec: before building, it is re-specced and
scored by the Codex gate like every M4 child.

**Unlocks:** everything in Mechanism 1 found by name instead of hand-written, plus #2 Playwright, #8 Chrome DevTools,
#17 Postgres and Supabase stdio, and the long tail: 315 marketplace plugins and about 20,000 registry servers.
Depends on Mechanism 1 for the remote ones.

**How**

1. Fix the Claude importer shapes: accept `.mcp.json` as either `{mcpServers: {...}}` or a bare map (Linear's
   shape), and keep `type: "http"` / `"streamable-http"` entries (Claude treats them as the same) with `url`,
   `headers` and `oauth`. `${VAR}` in a header becomes `secrets:VAR`, the same rule as env today.
2. `claude-marketplace:<owner/repo>[#<plugin>]`: read `.claude-plugin/marketplace.json`, list plugins, clone the
   chosen one at the **listed `sha`** (sources `url`, `git-subdir` with `path`, or in-repo path), then run the
   existing Claude importer on it. Hooks are still not imported (`plugins.md:127`).
3. `registry-import:<name>`: `GET https://registry.modelcontextprotocol.io/v0/servers?search=<name>&version=latest`,
   then map:
   - `packages[].registryType` `npm` to `npx -y <identifier>@<version>`; `pypi` to `uvx <identifier>==<version>`;
     `oci` to `docker run -i --rm <identifier>` (only when Docker is on PATH); `mcpb` and `nuget` skipped and listed.
   - `remotes[]` streamable-http to `transport: http`; `headers[]` to `${NAME}` templates and `secrets:` permissions.
   - `environmentVariables[]` with `isSecret` to `secrets:<NAME>`; non-secret ones with a `default` become
     fixed args.
   - `writes: external` by default for any remote; the user can lower it on the install screen.
4. Smithery: its REST API (`registry.smithery.ai/servers`) as a search source only. Its CLI is AGPL-3.0.

**Files to change**

- `core/src/plugins/importers.ts`: shape fix at `:110-118`; keep http at `:56-58`; `importMarketplace`,
  `importRegistry`; `importFromSource` at `:272-280`
- `contracts/schema.sql:188`: `plugin.source` CHECK adds `marketplace-import`, `registry-import`
- `contracts/plugins.md:118-138` importer table
- workbench plugin screen: a search box over registry and marketplace (`plugin.search`, a new read-only method)

**Manifest addition:** none beyond Mechanism 1. `import.json` gains
`{"origin": {"kind": "registry|marketplace", "name": "...", "version": "...", "sha": "..."}}` so an update is a
re-import with a fresh permission screen when permissions grow (rule already in `plugins.md:13-16`).

**Security rules**

- Pin: marketplace by `sha`, registry by exact `version`. `npx -y pkg@latest` is never generated.
- Registry and marketplace text (names, descriptions) is shown as data, never run.
- The install screen shows the exact command or URL, every secret, the remote host, and `writes`.
- `oci` needs Docker; `mcpb` (bundled binaries) is skipped at launch because it runs unsigned native code.

**Effort:** 2.5 CC days (shape fix 0.5, marketplace 1, registry 1). Smithery search 0.5 later.

**Acceptance tests**

- M5-13a: `claude-import` of a fixture copy of the official `linear` plugin produces one `transport: http` server
  at `https://mcp.linear.app/mcp`, `auth: engine-oauth`, no errors (today it produces zero).
- M5-13b: `claude-import` of the official `github` fixture produces `secrets:GITHUB_PERSONAL_ACCESS_TOKEN` and a
  header template, and no literal token anywhere under `~/.metatrooper/plugins/`.
- M5-13c: `registry-import` against a recorded registry response for `com.supabase/mcp` yields an npm stdio server
  pinned to the listed version and an http server; a recorded `mcpb`-only entry yields a "skipped" line.
- M5-13d: `claude-marketplace` with a fixture `marketplace.json` clones at the listed `sha`, not the branch head.
