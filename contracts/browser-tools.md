# metatrooper-browser MCP tools

Version 2. A stdio MCP server started through the engine's `mcp_attach` only for sessions that need it: sessions launched from the browser pane. Each tool call becomes one request on `\\.\pipe\metatrooper-browser` (see
`pipe-protocol.md`), 30 s timeout. If the pipe is missing, the tool returns an MCP error result
"browser not available: the MetaTrooper workbench is closed". It never hangs.

Its session is found by process ancestry and bound with `browser.hello` (see `pipe-protocol.md`), so it
needs no per-session configuration. Every tool takes `pane_id` (string). Call `panes` first. When the session owns exactly one pane, `pane_id` may
be omitted and that pane is used. When the session owns no pane, `navigate` opens one for it (`pane.open` with
`agent: true`). That pane has an in-memory partition of its own, so it starts logged out and shares no cookies
with the user's panes; its storage is cleared when it closes.

| Tool | Input | Output |
|---|---|---|
| `panes` | `{}` | `[{pane_id, url, dev_port}]` for panes this session may drive |
| `navigate` | `{pane_id, url}` | `{url, title, status}` plus the page state (below); opens an agent pane when the session has none |
| `back` | `{pane_id}` | the page state (below) |
| `snapshot` | `{pane_id, max_tokens?: int = 4000, scope_ref?, interactive?: bool, since_last?: bool, continue?}` | `{text, continue?}`: accessibility tree as text, each actionable node tagged `[ref=e12]` (main frame) or `[ref=f2e12]` (child frame `f2`); same-origin child frames are nested under their `Iframe` line and open shadow roots are included; `scope_ref` keeps the subtree under that ref; `interactive` keeps only nodes with a ref and their ancestors; `since_last` returns `+ line` for each line added and `- line` for each line removed since this session's previous snapshot of the pane with the same `interactive` and `scope_ref` (cleared on navigate) |
| `read` | `{pane_id, search?, max_tokens?: int = 4000, continue?}` | `{text, continue?}`: the `innerText` of `main`, `[role=main]`, `article` or `body`, one trimmed non-empty line per block; `search` keeps lines containing it, case-insensitive |
| `click` | `{pane_id, ref}` | `{ok}` plus the page state; fails with -32033 and clicks nothing when the element is disabled, outside the viewport, or covered by another element |
| `type` | `{pane_id, ref, text, submit?: bool}` | `{ok}` plus the page state; replaces the field's text (select all, then insert); same checks as `click` |
| `select` | `{pane_id, ref, value}` | `{ok}` plus the page state; runs through `DOM.resolveNode` and `Runtime.callFunctionOn` (set `value`, dispatch `input` and `change`), since `Input.*` cannot choose an option |
| `scroll` | `{pane_id, ref?, dy: int}` | `{scroll_y}` |
| `wait_for` | `{pane_id, text? , ref?, timeout_ms?: int = 10000}` | `{found: bool}` |
| `screenshot` | `{pane_id, full_page?: bool = false, ref?, format?: 'jpeg' \| 'png' = 'jpeg'}` | image content, JPEG quality 80 by default; `ref` crops to that element's border box; the image is scaled down so no side is over 1,568 px |
| `evaluate` | `{pane_id, expression}` | `{value}` (JSON-serialisable result, 20 KB cap) |
| `console` | `{pane_id, since_ms?: int}` | last 200 console messages, uncaught page errors (`error`), dialogs and blocked requests |
| `network` | `{pane_id, since_ms?: int}` | last 200 requests: method, url, status, bytes, and `error` for a failed request |
| `dialog` | `{pane_id, accept: bool, prompt_text?}` | `{ok, handled: {type, message}}`; answers the open alert, confirm or beforeunload dialog; Electron does not implement `prompt()`, which returns null without a dialog |

While a dialog is open, every tool except `dialog`, `console` and `network` fails with -32032 naming it. A tool
that opens a dialog while it runs returns `{ok: true, dialog: {type, message}}` straight away.

A ref whose element has left the page fails with "no longer on the page; call snapshot again"; one with no layout
box fails with "not visible".

## Version 2 (M6-11)

- **Refs.** A ref is kept for the life of its element: keyed by frame id plus `backendDOMNodeId`, so two snapshots
  of an unchanged page give the same refs. Ref numbers are never reused while the pane is open. When the main frame
  navigates every ref ends; when a child frame navigates or is detached (`Page.frameNavigated`,
  `Page.frameDetached`) that frame's refs end. An ended ref, and a ref whose element is no longer connected, fails
  with "no longer on the page; call snapshot again". Frame tags (`f1`, `f2`) are kept per frame for the pane's life.
- **Frames and shadow roots.** `snapshot` reads `Accessibility.getFullAXTree` per frame from `Page.getFrameTree` and
  nests each child frame under the line of its owner (`DOM.getFrameOwner`). A frame whose tree cannot be read
  (cross-origin, out of process) is left out. Actions on a frame ref resolve the node in an isolated world of that
  frame, and the covered check runs in the element's own document or shadow root.
- **Budget.** `max_tokens` (200 to 100,000, default 4,000) is counted with `tokenCount` in `core/src/meter.ts`
  (one token per 3 UTF-8 bytes, rounded up). Order: `scope_ref`, then `interactive`, then `since_last`, then the
  budget. When cut, the text ends with the line `(cut at N tokens; call snapshot with continue="cN" for the rest)`
  inside the budget, and `continue` is set; calling the same tool with only `continue` (and optionally
  `max_tokens`) returns the next part. The 8 newest cursors per pane are kept; navigation clears them.
- **Page state after an action.** `navigate`, `back`, `click`, `type` and `select` wait up to 1 s for the page to
  stop loading, then return `url`, `title`, `dialog` when one is open, `errors` (console errors since the action
  started, last 20) and `changes`: the `since_last` diff of the interactive snapshot against this session's previous
  interactive snapshot (or the whole interactive snapshot after a navigation), cut at 1,000 tokens with `continue`.
- **Tool hints.** `tools/list` gives `panes`, `snapshot`, `screenshot`, `read`, `console`, `network` and `wait_for`
  `annotations: {readOnlyHint: true}`, and every other tool `{readOnlyHint: false, destructiveHint: true}`.
- **Crashes.** After `render-process-gone` every tool fails at once with -32034 "the page crashed; call navigate to
  load it again"; `navigate` reloads the renderer, re-attaches the debugger with interception on, then loads. After
  `unresponsive`, every tool fails with -32034 "the page is not responding" until `responsive`.

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
   `http://127.0.0.1:<port>` and `http://[::1]:<port>` only for owned ports (D60): a pane a session drives owns the
   ports of that session's `ready` `session_dev_server` rows; a user pane (`session_id` NULL) owns the loopback ports
   the user typed into its URL box.
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
