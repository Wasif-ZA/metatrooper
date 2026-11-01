# M8-42: Browser engines: one default per job, and a headless tier

Part of Ouros, Milestone 8. Priority: Medium. Effort: 6.0 CC days. Depends on: M8-14, M8-41.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section "Computer use and browser use (2026-11-02)", and 5c for the plugin rule.
- Research: scratch `ouros-computer-use-2026-11-02/lanes/browser-engines/reply.md`.

## Engine per job

| Job | Default | Runner-up | Why |
|---|---|---|---|
| A pane you watch | Electron webContents (today) | none needed | In-process CDP, no debugging port, sits inside the wall. CEF adds nothing for an Electron app |
| Background agents | Chrome for Testing `chrome-headless-shell` | Obscura, opt-in, for pages that need little JS | Real Chromium, full CDP, Windows builds. About 133-144 MB per session in one third-party cloud benchmark (browser-gateway, 2026-07-22) |
| Research and scraping | `chrome-headless-shell`, reading markdown (M8-41 row 5) | Obscura | Lightpanda would suit but has no native Windows binary (its README: use WSL2; 1.0.2 ships Linux and macOS only) |
| Testing the user's own app | Playwright Chromium | Playwright Firefox and WebKit | The only Firefox and WebKit builds on Windows here. They speak Playwright's own protocol, not CDP |
| Sites that block bots | None. The agent stops and asks | The site's API, or your logged-in pane | Ouros ships no stealth feature |

## Engine notes

- **Lightpanda** (39.8k, AGPL-3.0): CDP and MCP. Plugin only; offered only where WSL is present. Its speed and memory figures are vendor-run.
- **Obscura** (29.9k, Apache-2.0, v0.2.6, created 2026-04-13): Windows zips, CDP, MCP. All speed claims are vendor claims. Open issues show WebGL, worker and fetch-interception gaps, so a failure falls back to Chromium.
- **Watch only:** Servo (no complete CDP). **Skip:** Ladybird (pre-alpha, no Windows port), WebView2 (one CDP port shared by all controls, per Microsoft).
- **Stealth engines exist:** CloakBrowser (MIT wrapper, proprietary binary, latest version paid), Camoufox (MPL-2.0, beta). They exist to get past a site's bot checks, which can breach its terms. Never bundled, never recommended.

## What gets built

| # | Change | Days |
|---|---|---|
| 1 | An `engine` field on a browser session, default `electron`, only once row 3 exists as the second engine. Same tool list on every engine | 2 |
| 2 | A per-tool `needs_pixels` flag, so a non-rendering engine says "not supported on this engine" instead of failing oddly. Shape read at lightpanda-io/browser `c3b9247` `src/mcp/tools.zig#L444-L449` (AGPL: idea only, no code) | 1 |
| 3 | `chrome-headless-shell` as a user-installed plugin at a pinned version, driven over `--remote-debugging-pipe`, one browser with one context per agent. Approval, origin and secret rules apply as they do on a pane | 2.5 |
| 4 | Registry columns: `platform: native or wsl`, and the binary's licence judged apart from its client's | 0.5 |

## Measure before promising

No source gives memory per Electron webContents. Measure it and headless-shell's per-context memory on this laptop before
stating a swarm size.

## Acceptance criteria

- [ ] M8-42a. An agent runs the same tool calls on `electron` and on `chrome-headless-shell`, with only the `engine` field changed.
- [ ] M8-42b. `screenshot` on a non-rendering engine returns a named refusal.
- [ ] M8-42c. A headless session asks approval for a new origin, as a pane does.
- [ ] M8-42d. Memory per pane and per headless context is measured on this laptop and recorded here.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Engines stay separate processes, installed by the user. No em dashes.
