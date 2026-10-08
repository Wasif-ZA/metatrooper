# metatrooper-browser MCP tools

Version 1. A stdio MCP server started through the engine's `mcp_attach` only for sessions that need it: pipeline steps with `browser: true` and sessions launched from the browser pane. Each tool call becomes one request on `\\.\pipe\metatrooper-browser` (see
`pipe-protocol.md`), 30 s timeout. If the pipe is missing, the tool returns an MCP error result
"browser not available: the MetaTrooper workbench is closed". It never hangs.

Its session is found by process ancestry and bound with `browser.hello` (see `pipe-protocol.md`), so it
needs no per-session configuration. Every tool takes `pane_id` (string). Call `panes` first. When the session owns exactly one pane, `pane_id` may
be omitted and that pane is used. When the session owns no pane, `navigate` opens one for it (`pane.open` with
`agent: true`). That pane has an in-memory partition of its own, so it starts logged out and shares no cookies
with the user's panes; its storage is cleared when it closes.

| Tool | Input | Output |
|---|---|---|
| `panes` | `{}` | `[{pane_id, url, variant, dev_port}]` for panes this session may drive |
| `navigate` | `{pane_id, url}` | `{url, title, status}`; opens an agent pane when the session has none |
| `back` | `{pane_id}` | `{url}` |
| `snapshot` | `{pane_id, max_nodes?: int = 400}` | accessibility tree as text, each actionable node tagged `[ref=e12]` |
| `click` | `{pane_id, ref}` | `{ok}`; fails with -32033 and clicks nothing when the element is disabled, outside the viewport, or covered by another element |
| `type` | `{pane_id, ref, text, submit?: bool}` | `{ok}`; replaces the field's text (select all, then insert); same checks as `click` |
| `select` | `{pane_id, ref, value}` | `{ok}`; runs through `DOM.resolveNode` and `Runtime.callFunctionOn` (set `value`, dispatch `input` and `change`), since `Input.*` cannot choose an option |
| `scroll` | `{pane_id, ref?, dy: int}` | `{scroll_y}` |
| `wait_for` | `{pane_id, text? , ref?, timeout_ms?: int = 10000}` | `{found: bool}` |
| `screenshot` | `{pane_id, full_page?: bool = false}` | PNG image content |
| `evaluate` | `{pane_id, expression}` | `{value}` (JSON-serialisable result, 20 KB cap) |
| `console` | `{pane_id, since_ms?: int}` | last 200 console messages, uncaught page errors (`error`), dialogs and blocked requests |
| `network` | `{pane_id, since_ms?: int}` | last 200 requests: method, url, status, bytes, and `error` for a failed request |
| `dialog` | `{pane_id, accept: bool, prompt_text?}` | `{ok, handled: {type, message}}`; answers the open alert, confirm or beforeunload dialog; Electron does not implement `prompt()`, which returns null without a dialog |

While a dialog is open, every tool except `dialog`, `console` and `network` fails with -32032 naming it. A tool
that opens a dialog while it runs returns `{ok: true, dialog: {type, message}}` straight away.

A ref whose element has left the page fails with "no longer on the page; call snapshot again"; one with no layout
box fails with "not visible".

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
2. Navigation allowlist: `http:` and `https:` (and `ws:` and `wss:`, checked the same way) to public addresses, plus `http://localhost:<port>` and
   `http://127.0.0.1:<port>` only for ports owned by this project (`browser_pane.dev_port`, `variant.dev_port`).
   Blocked: `file:`, `chrome:`, `devtools:`, other loopback ports, and these ranges unless the project's
   `.troop/config.json` lists the host: IPv4 `0.0.0.0/8`, `10.0.0.0/8`, `127.0.0.0/8` (except owned dev
   ports), `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`; IPv6 `::/128`, `::1/128`
   (except owned dev ports), `fc00::/7`, `fe80::/10`, and IPv4-mapped `::ffff:0:0/96` checked against the IPv4
   list. Enforced with `Fetch.enable` interception on every request, not only top-level navigation, so a
   page script cannot reach a blocked host either. On each `Fetch.requestPaused`, the workbench resolves the
   host with node's `dns.lookup(host, {all: true})` and blocks the request if any returned address is in a
   blocked range, so a public name that resolves to a private address is blocked too. The browser resolves the
   host again when it connects, so on each `Network.responseReceived` the workbench re-checks the URL against
   `response.remoteIPAddress` (`connectedVerdict`); a mismatch (DNS rebinding) loads `about:blank` in the pane and
   logs the block. Headers, and possibly the first body bytes, can arrive before that abort.
3. `evaluate` runs in an isolated world (`Page.createIsolatedWorld`) and is subject to the same request
   interception. Its result is capped at 20 KB.
4. Browser panes use a separate Electron session partition per project (`persist:troop-<project_id>`), so
   cookies and storage never mix between projects.

## As built (child #17)

- Panes are `WebContentsView`s in the workbench window. The pane on screen has the Browser tab's bounds; every
  other pane stays attached as a 1 px view in the window corner with `Emulation.setDeviceMetricsOverride`
  1280 by 800, because a view moved off-window gets a zero-size viewport (no layout, no clicks, a 58 px wide
  capture) and a hidden view (`setVisible(false)`) never renders a capture.
- The cursor overlay is a transparent view laid over the pane only while an agent acts (about 1.5 s), so it
  never takes the user's clicks.
- Before each request is let through, the host is resolved (results cached for 5 s) and checked by
  `core/src/browser/policy.ts`. A loopback address is allowed only when the URL names `localhost`, `127.0.0.1`
  or `[::1]` itself on an owned port, so any other name that resolves to loopback is blocked. `data:`, `blob:`
  and `about:blank` pass. The pane's partition also cancels every non-web scheme before the request starts.
- `evaluate` results over 20 KB come back as the first 20 KB of their JSON with `truncated: true`.
- On hosts other than Windows the browser pipe is the socket file `<tmp>/<prefix>-browser.sock`, because
  agents run from other folders than the workbench.
- Point-to-comment uses the pane debugger's inspect mode (`Overlay.setInspectMode`); the body is
  `[comment <id>] <note>`, then `Page:`, `Element:` (a CSS path), the outer HTML (2,000 characters) and `Crop:`.
- Tool calls on a new pane wait until its debugger is attached and interception is on.
- An error while deciding a paused request fails the request; it is never left paused.
- Each partition's `webRequest.onBeforeRequest` also runs the safety rule 2 check on every request, so
  cross-site iframes, workers and WebSockets are covered. `ws:` and `wss:` are checked as `http:` and `https:`,
  so dev-server live reload works on owned ports.
- User panes: `target=_blank` and "Open link in new pane" open a new user pane; downloads save to the
  Downloads folder under a unique name; clipboard-read, notifications, media and geolocation ask the user once
  per origin per app run. Agent and board panes load popups in place, cancel downloads and deny every
  permission.
- User panes take Ctrl+L, Ctrl+F, Ctrl+R / F5, Alt+Left / Right, Ctrl+= / - / 0 and F12, and have a
  right-click menu. Typed URL box input: a scheme is kept, loopback and IPs get `http://`, a dotted host gets
  `https://`, anything else is a DuckDuckGo search (`typedUrl` in `core/src/browser/policy.ts`).
- `metatrooper-browser` is attached to Claude sessions through their `--mcp-config` file and to Codex sessions
  through `-c mcp_servers.metatrooper-browser.*`. agy sessions are not attached yet (its MCP config file is not
  verified), so M1-23 for agy waits on that.
