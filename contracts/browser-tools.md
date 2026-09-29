# harness-browser MCP tools

Version 1. A stdio MCP server started per agent session through the engine's `mcp_attach`. Each tool call becomes one request on `\\.\pipe\agent-harness-browser` (see
`pipe-protocol.md`), 30 s timeout. If the pipe is missing, the tool returns an MCP error result
"browser not available: the Agent Harness workbench is closed". It never hangs.

Its session is found by process ancestry and bound with `browser.hello` (see `pipe-protocol.md`), so it
needs no per-session configuration. Every tool takes `pane_id` (string). Call `panes` first. When the session owns exactly one pane, `pane_id` may
be omitted and that pane is used.

| Tool | Input | Output |
|---|---|---|
| `panes` | `{}` | `[{pane_id, url, variant, dev_port}]` for panes this session may drive |
| `navigate` | `{pane_id, url}` | `{url, title, status}` |
| `back` | `{pane_id}` | `{url}` |
| `snapshot` | `{pane_id, max_nodes?: int = 400}` | accessibility tree as text, each actionable node tagged `[ref=e12]` |
| `click` | `{pane_id, ref}` | `{ok}` |
| `type` | `{pane_id, ref, text, submit?: bool}` | `{ok}` |
| `select` | `{pane_id, ref, value}` | `{ok}`; runs through `DOM.resolveNode` and `Runtime.callFunctionOn` (set `value`, dispatch `input` and `change`), since `Input.*` cannot choose an option |
| `scroll` | `{pane_id, ref?, dy: int}` | `{scroll_y}` |
| `wait_for` | `{pane_id, text? , ref?, timeout_ms?: int = 10000}` | `{found: bool}` |
| `screenshot` | `{pane_id, full_page?: bool = false}` | PNG image content |
| `evaluate` | `{pane_id, expression}` | `{value}` (JSON-serialisable result, 20 KB cap) |
| `console` | `{pane_id, since_ms?: int}` | last 200 console messages |
| `network` | `{pane_id, since_ms?: int}` | last 200 requests: method, url, status, bytes |

## How a tool runs

When a browser pane is created, the workbench main process attaches the debugger to that pane's
`webContents` only (`webContents.debugger.attach("1.3")`). The workbench's own UI `webContents` never has a
debugger attached. Then, per call, the workbench main process resolves `ref` to a node through the last `snapshot`, gets its box through
`DOM.getBoxModel`, emits the cursor point to the renderer (overlay moves, 150 ms ease), waits for the ease,
then runs the action with `webContents.debugger.sendCommand` (`Input.dispatchMouseEvent`,
`Input.insertText`, `Input.dispatchKeyEvent`). Coordinates are CSS pixels of the view; the overlay converts
with the view's zoom factor and the display's scale factor.

## Full-page capture

`webContents.capturePage()` returns the visible viewport only, and stitching scrolled slices repeats sticky
headers. Full-page screenshots use the pane's debugger instead: `Page.getLayoutMetrics` for the content size,
then `Page.captureScreenshot` with `captureBeyondViewport: true` and a clip of the full content. Capped at
16,384 px tall; longer pages are clipped and marked `truncated: true`.

## Safety rules, enforced in the workbench

1. Only panes listed by `panes` for that session can be driven. The workbench UI has no debugger attached.
2. Navigation allowlist: `http:` and `https:` to public addresses, plus `http://localhost:<port>` and
   `http://127.0.0.1:<port>` only for ports owned by this project (`browser_pane.dev_port`, `variant.dev_port`).
   Blocked: `file:`, `chrome:`, `devtools:`, other loopback ports, and these ranges unless the project's
   `.harness/config.json` lists the host: IPv4 `0.0.0.0/8`, `10.0.0.0/8`, `127.0.0.0/8` (except owned dev
   ports), `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`; IPv6 `::/128`, `::1/128`
   (except owned dev ports), `fc00::/7`, `fe80::/10`, and IPv4-mapped `::ffff:0:0/96` checked against the IPv4
   list. Enforced with `Fetch.enable` interception on every request, not only top-level navigation, so a
   page script cannot reach a blocked host either. On each `Fetch.requestPaused`, the workbench resolves the
   host with node's `dns.lookup(host, {all: true})` and blocks the request if any returned address is in a
   blocked range, so a public name that resolves to a private address (DNS rebinding) is blocked too.
3. `evaluate` runs in an isolated world (`Page.createIsolatedWorld`) and is subject to the same request
   interception. Its result is capped at 20 KB.
4. Browser panes use a separate Electron session partition per project (`persist:harness-<project_id>`), so
   cookies and storage never mix between projects.
