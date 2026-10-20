# M7-11: Every agent gets a browser

Part of the MetaTrooper desk epic, Milestone 7. Priority: High. Effort: 1.0 CC day. Depends on: M6-11.

## Source of truth

- `contracts/browser-tools.md` (version 2) and `contracts/pipe-protocol.md` (`session.launch`, `pane.assign`).
- If this file and a contract disagree, the contract wins until this issue changes the contract.

## Context

On 2026-10-13 Wasif asked a Claude session in the workbench to research Sydney retail jobs with the MetaTrooper
browser. He opened a browser pane and set "Driven by" to that session. The session had no browser tools, so it could
not drive the pane. His words: "an agent can open its own browser and have full access to".

An agent should be able to open its own pane and drive it, with no setup by Wasif. Today no normal launch path gives
an agent the browser at all.

## Current state (verified 2026-10-13 at 72044ec)

| Piece | Where | State |
|---|---|---|
| Browser MCP attach | `core/src/plugins/mcp.ts:106-110` | `metatrooper-browser` is added only when `browser` is true |
| Launch | `core/src/sessions/launch.ts:91,94` | Passes `opts.browser` to `mcpAttachArgs` / `mcpAttachEnv` |
| `session.launch` | `core/src/methods.ts:218` | `browser: p.browser === true`; default false |
| Workbench launches | `workbench/renderer/app.js:753,1173,1212` | Palette, Start box and engine button; none sends `browser` |
| `troop launch` | `core/cli.ts:341-360` | Builds params with no `browser`; no flag for it |
| Pipelines | removed from core in M6-1 (`3d325bb`) | The old `browser: true` step was the only caller that set it |
| "Driven by" | `workbench/renderer/browser-chrome.js:64`, `app.js:1378` | `pane.assign` sets who may drive; lists sessions with no browser server too |
| Agent's own pane | `contracts/browser-tools.md:8-11` | `navigate` with no owned pane opens an agent pane (`pane.open` with `agent: true`), in-memory partition |

So the contract line "sessions launched from the browser pane" describes a path that does not exist in the
renderer. The only way to get `browser: true` is a raw pipe call with the UI key.

A running Claude Code session cannot add an MCP server, so assigning a pane later never helps.

## Proposed change

1. **Attach by default.** `session.launch` attaches `metatrooper-browser` unless `browser: false` is passed.
   New setting `sessions.browser` (default `true`) sets the default. Engines without a verified `mcp_attach`
   (agy today) are unchanged.
2. **CLI.** `troop launch` takes `--browser` and `--no-browser`; a `--jobs` entry takes `"browser": bool`.
3. **Remember it.** Store `session.browser` (0/1) so `session.resume` relaunches with the same attach.
4. **Driven by.** A session with `session.browser = 0` shows "(no browser tools)" and is greyed out, unless it
   already owns the pane. No relaunch item: `session.resume` only takes an exited session.
5. **Contract.** `browser-tools.md` line 3 and the `session.launch` and `session.resume` rows in
   `pipe-protocol.md` say the server is attached to every session unless `browser: false` or
   `sessions.browser` is off (D83).

`session.browser` is 1 only when the server was really attached: a pty host and an engine whose `mcp_attach` can
carry a stdio server (`attachesBrowser` in `core/src/plugins/mcp.ts`). Sandbox sessions and agy stay 0.

Nothing in the safety rules changes. Agent panes keep their in-memory partition, the navigation allowlist, request
interception and the approval check on `click`, `type`, `select` and `key`.

## Acceptance

- M7-11a. A session started from the Start box, the palette, the engine button and `troop launch` (no flag) has
  the browser tools; `navigate` opens an agent pane for it.
- M7-11b. `troop launch --no-browser` and `sessions.browser: false` give a session without the server; its
  `--mcp-config` file has no `metatrooper-browser` entry.
- M7-11c. `session.resume` of a browser session attaches the server again.
- M7-11d. In "Driven by", a session without the server is greyed out and labelled "(no browser tools)"; one that
  already owns the pane stays checked and enabled.
- M7-11e. With the workbench closed, a browser tool still returns "browser not available: the MetaTrooper
  workbench is closed" and does not hang.
- M7-11f. `troop stop` from an interactive terminal stops the core and waits until `core.ping` fails;
  `troop restart` then starts it again with a new pid; `troop stop` with no core prints "core was not running"
  and exits 0. From a non-interactive shell (an agent) `core.stop` is refused with -32012 and the core keeps running.

- M7-11g. `troop browser <tool> [json]` from an agent shell binds to that session and runs the tool; `navigate` with no
  owned pane opens one; `screenshot` writes a file and prints its path; bad JSON exits 2; a refused hello says why.
- M7-11h. A session launched with the browser gets `TROOP_BROWSER_TOKEN` (64 hex) in its environment and only its
  sha256 in `session.browser_token_hash`. `browser.hello` with the right token binds without ancestry; a wrong token
  is -32030; a session with no hash falls back to ancestry. An inherited token in the core's own environment never
  reaches a session.

## Any session, at any time

Wasif, 2026-10-13: "all session should have access to the broswer at any point and its able open its own pane too".
An MCP server cannot be added to a running session, so the attach alone never reaches sessions already open. The
browser pipe is served by the workbench, not the core, and binds by process ancestry, so `troop browser` (the same
client as the MCP server, `core/src/browser/agent-client.ts`) works from any session's own shell.

Ancestry breaks under Git Bash: every `sh -c` layer, including the npm `troop` shim, leaves a parent that has
already exited, so the chain ends early (measured: direct `node` sees the session's pid, `sh -c node` does not).
PowerShell and `troop.cmd` keep it. Decision (Wasif, 2026-10-13): a per-session token with ancestry as the
fallback, so new sessions work through any shell and sessions already running keep the ancestry path.

- M7-11i. A Claude session launched with the browser gets one `--append-system-prompt` holding the metarouter block
  and `BROWSER_BLOCK` (how to call `troop browser`); with metarouter off, `BROWSER_BLOCK` alone; with `browser: false`,
  no browser block. Codex and agy have no instructions arg and learn it from `skills/troop/SKILL.md`.
- M7-11j. A child frame's in-page navigation never changes the pane URL (`did-navigate-in-page` checks
  `isMainFrame`); seen live on a careers page whose chat-widget iframe replaced the pane URL.

## Hardening found while using it (2026-10-13)

- A command moved to the background, or run through `bash script.sh` or `sh -c`, loses the ancestry chain; the token
  covers these once the session was launched by a core with M7-11.
- A page that fails to load (seen: rokt.com/careers, careers.sig.com) shows the pane's own error page and `navigate`
  fails -32099; working as specified.

## Restarting the core

The new attach only reaches sessions launched by a core running this code, so the core has to restart. The
workbench palette already has "Restart core" and "Stop core" (`workbench/renderer/app.js:777-778`). The CLI had only
`start` and `serve`, so `troop stop` and `troop restart` are added in `core/cli.ts`. Both call `core.stop`, which needs
`ui.hello`, so an agent cannot stop the core it runs under.

Tests come from Codex, not the session that builds this.
