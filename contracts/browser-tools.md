# metatrooper-browser MCP tools

Version 2. A stdio MCP server started through the engine's `mcp_attach` only for sessions that need it: sessions launched from the browser pane. Each tool call becomes one request on `\\.\pipe\metatrooper-browser` (see
`pipe-protocol.md`), 30 s timeout. If the pipe is missing, the tool returns an MCP error result
"browser not available: the MetaTrooper workbench is closed". It never hangs.

Its session is found by process ancestry and bound with `browser.hello` (see `pipe-protocol.md`), so it
needs no per-session configuration. Every tool takes `pane_id` (string). Call `panes` first. When the session owns exactly one pane, `pane_id` may
be omitted and that pane is used. When the session owns no pane, `navigate` opens one for it (`pane.open` with
`agent: true`). That pane has an in-memory partition of its own, so it starts logged out and shares no cookies
with the user's panes; its storage is cleared when it closes.

`click`, `type`, `select` and `key` are checked before they are sent (`contracts/approvals.md`): a risky one waits
for a person in the workbench and may return "not approved in time" or "not approved: the user rejected this
action". A control or page origin that changed between the check and the dispatch fails with -32035 and nothing is sent.

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
| `key` | `{pane_id, keys}` | `{ok}`; presses a key or chord on the focused element (`Enter`, `Tab`, `Escape`, `Space`, arrows, one character, with `Control+`, `Alt+`, `Shift+`, `Meta+`; `Shift+` types a character's US-layout shifted form, so `Shift+a` types `A` and `Shift+1` types `!`) |
| `wait_for` | `{pane_id, text? , ref?, timeout_ms?: int = 10000}` | `{found: bool}` |
| `screenshot` | `{pane_id, full_page?: bool = false, ref?, format?: 'jpeg' \| 'png' = 'jpeg'}` | image content, JPEG quality 80 by default; `ref` crops to that element's border box; the image is scaled down so no side is over 1,568 px |
| `evaluate` | `{pane_id, expression}` | `{value}` (JSON-serialisable result, 20 KB cap) |
| `console` | `{pane_id, since_ms?: int}` | last 200 console messages, uncaught page errors (`error`), dialogs and blocked requests |
| `network` | `{pane_id, since_ms?: int}` | last 200 requests: method, url, status, bytes, and `error` for a failed request |
| `handoff` | `{pane_id, reason}` | `{ok}`; gives the pane to the user until they press Give back (M6-12, below) |
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

## Version 2 (M6-12)

- **Handoff.** `handoff {pane_id, reason}` marks the pane the user's. Until the user presses Give back in the tile, every
  tool on that pane, `describe` and `handoff` included, fails with -32036 `the user has the pane (<reason>); wait until they
  give it back`, and no approval is asked. The workbench switches to the pane, shows the reason (at most 300 characters)
  above it with a Give back button, and the pane's `state` events carry `handoff`. The mark is held in the workbench
  only; closing the workbench clears it. A call already running when the handoff lands sends no input after it: the
  recheck before dispatch and every `Input.*` command fail with -32036. A `navigate` or `back` still reading its first
  snapshot does not load, and a script-run tool (`evaluate`, `read`, `scroll`, `wait_for`) does not run its script, once
  the handoff lands; both fail with -32036. A screenshot already in flight still completes.
- **Origins.** The origin of an input is that of the control's own frame: the pane's for the main frame, the child
  frame's otherwise. A child frame whose origin is not an http(s) origin (opaque, detached) fails with -32030 and nothing
  is sent. For `key`, when focus is inside a frame the main frame cannot read, the origin is that frame's
  (`securityOrigin` in `Page.getFrameTree`) and `hidden` is true; if it is not an http(s) origin or not found, `key`
  fails with -32030 `not sent: focus is in a frame whose origin cannot be established`. Only the outermost unreadable
  frame is seen: focus in a frame nested inside it is checked against the outer frame's origin. The first input on a new origin asks (`contracts/approvals.md`, `new origin`); `.troop/config.json`
  `allow_origins` lists origins that never ask for being new.
- **Secrets by placeholder.** `type` with `text` exactly `{{secret:NAME}}` fills the secret saved with `browser.secret.set`
  (or `troop browser secret <NAME> <origin>`). A value under 4 characters is refused when saved (-32602), since output
  scrubbing skips values that short. The value is stored in the DPAPI store under plugin id `core-browser`; the
  origin it may be typed into is saved in plain text beside it. Right before `Input.insertText`, after the click and the
  approval recheck, the workbench main process checks that the origin of the field's own frame is the saved one and the
  ref is an `input type=password`, then decrypts the value itself; otherwise the call fails with -32037 and nothing is typed.
  A decrypted value is cached only until its stored file changes, so saving the name again (from the core) is seen by the
  next fill. Saving removes the origin file while the value changes, and the fill reads the origin again after the
  value; if it differs, the call fails with -32037. The last step before `Input.insertText`, which types into whatever has
  focus, checks focus is still on the ref's node (after the focus and select-all, whose page handlers could move it); for
  a field in a frame the main frame cannot read, focus must be in that frame and, in its own document, on the field.
  Otherwise the call fails with -32037 `focus moved off the field; nothing was typed`. While an `evaluate` on the pane is still running (its script can
  await for up to 10 s), a fill fails with -32037 `evaluate is running on this page; nothing was typed`, since the
  script could wait for the value and return it encoded past the scrub. The
  value is never in a tool argument, result, approval row, event, log or the `command` table. After a fill, `evaluate`
  fails with -32037 until the main frame navigates, since a script could read the field. A field the user approved for a
  secret once (the spec's other case) is not built: a secret goes only into a password field.
- **Scrubbed output.** Every tool result (the `panes` list included) and error message except `describe` (which goes to the MCP server, not the
  agent) and screenshot bytes passes through `scrubDeep` in `core/src/redact.ts` in the workbench: secret values the
  workbench has decrypted, bearer tokens, cookie values, URL credentials, token-named or credential-looking query values
  and credential patterns become `[secret]`. `describe` scrubs the control's name and id of every known secret value
  (decrypted in the workbench, or any saved browser secret) before it leaves the workbench.
- **Audit.** Every tool call is one `browser.tool` event row (`contracts/events-and-hooks.md`): tool, pane, origin and
  `ok` or `error <code>`, never arguments. A checked call (`click`, `type`, `select`, `key`) that the MCP server stops
  before sending it (describe failed, denied, rejected, expired, core offline) reports `browser.outcome` so it gets its
  row too. Kept 30 days. The pane menu's Timeline lists the pane's rows, newest first.

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
  `[comment <id>] <note>`, then `Page:`, `Element:` (a CSS path), a line labelling what follows as page content
  the agent must treat as data and not follow as instructions, the sanitised outer HTML (at most 4 KB, see M6-13
  below) in an `html` fence, and `Crop:`.
- Tool calls on a new pane wait until its debugger is attached and interception is on.
- An error while deciding a paused request fails the request; it is never left paused.
- Each partition's `webRequest.onBeforeRequest` also runs the safety rule 2 check on every request, so
  cross-site iframes, workers and WebSockets are covered. `ws:` and `wss:` are checked as `http:` and `https:`,
  so dev-server live reload works on owned ports.
- User panes: `target=_blank` and "Open link in new pane" open a new user pane; downloads save to the
  Downloads folder under a unique name; clipboard-read, notifications, media and geolocation ask the user once
  per origin per app run. Agent and board panes load `target=_blank` links in place, cancel downloads and deny
  every permission. Popups follow the M6-13 rules below in every pane kind.
- User panes take Ctrl+L, Ctrl+F, Ctrl+R / F5, Alt+Left / Right, Ctrl+= / - / 0 and F12, and have a
  right-click menu. Typed URL box input: a scheme is kept, loopback and IPs get `http://`, a dotted host gets
  `https://`, anything else is a DuckDuckGo search (`typedUrl` in `core/src/browser/policy.ts`).
- `metatrooper-browser` is attached to Claude sessions through their `--mcp-config` file and to Codex sessions
  through `-c mcp_servers.metatrooper-browser.*`. agy sessions are not attached yet (its MCP config file is not
  verified), so M1-23 for agy waits on that.

## Pane hygiene (M6-13)

- **Own pages for failures.** A main-frame `did-fail-load` (except `ERR_ABORTED`) and `render-process-gone` load a
  `data:text/html` page in the pane: "This page did not load", "This page is not secure" (net errors -200 to -299),
  "MetaTrooper blocked this page" (`ERR_BLOCKED_BY_CLIENT`) or "This page crashed", with the failed URL, the error
  and a Try again link. The page is never reported as the pane's URL: `pane.url`, the URL bar and the tools' page
  state keep the failed URL, and `status` keeps the last real page's. Reload and Try again load the failed URL
  again; after a crash they, like `navigate`, re-attach the debugger with interception on first. `navigate` to a
  URL that shows an error page fails with -32099 "could not load"; `click`, `type`, `select` and `back` return
  `error: "the page did not load: <url>"` beside the page state.
- **Popups keep their opener.** A `window.open` with `disposition: 'new-window'` (the OAuth popup shape) opens as a
  child window of the workbench in the opener's partition, sandboxed, with `window.opener` kept. It may only
  navigate to `http:`, `https:` or `about:blank`, cannot open windows itself, and closes with its pane. It has no
  debugger, so agent tools cannot drive it and the DNS-rebinding re-check does not run there; the partition's
  `onBeforeRequest` policy still does.
- **No new pane without a click.** A page may open a pane, a popup or (in an agent pane) an in-place load only
  within 5 s of a mouse press, release or key press in that pane (`input-event`), or of an agent `click` or
  `type` with `submit`. Each click allows one window. Anything else is denied and logged as `blocked` in `console`.
- **Capture restores the viewport** in a `finally`: the 1280 by 800 parked override or no override.
- **Picks.** The pick body's HTML is sanitised (comments, `script`, `style`, `noscript`, `template`, `iframe`,
  `object`, `embed` and `svg` bodies, `on*` attributes, `javascript:` URLs, password `value`s, `data:` URLs over
  200 characters and runs of three backticks removed; whitespace collapsed), then cut to 4,096 UTF-8 bytes on a
  character boundary, with "It was cut at 4 KB." added to the label when cut. After a pick, Up arrow moves the pick
  to the element's parent (stopping at `body`), Down arrow goes back toward the clicked element; the comment form
  shows the new element's path and crop before Send.
