# Idea coverage: every mined idea and where it went

Written 2026-10-11T15:36+11:00 for Milestone 7 (spec.md D77). Source: the idea mine of 2026-10-10 (browser, core, wall,
agent-cursor and computer-use lanes, plus the rival angles), 157 ideas. Each row says whether the idea is already
built or in Milestone 6, in a Milestone 7 child, or left out and why.

Totals: 89 built or in M6, 54 in M7 (some partly M6), 14 left out, cut or moved.

| Idea | What | Size | Where it went |
|---|---|---|---|
| browser-control 1 | Keep refs stable across snapshots and make since_last a real diff | M | M6-11 stable refs, M6-11a |
| browser-control 2 | Return the page state after every action, after a short settle wait | M | M6-11 page answers every action |
| browser-control 3 | Let the agent hand a pane to the user and refuse its tools until the user gives it back | M | M6-12 handoff |
| browser-control 4 | Give each session a capability list and hide the tools it does not hold | M | M7-1 |
| browser-control 5 | Scope the origins an agent pane may reach, with allow-once, session and always on first visit | M | M6-12 origins + D61 first-input approval |
| browser-control 6 | Type secrets by placeholder, bound to an origin, and scrub them from replies | M | M6-12 secrets by placeholder |
| browser-control 7 | Add a token budget, a scope and a continuation to snapshot | M | M6-11 bounded output |
| browser-control 8 | Read child frames and shadow roots in the snapshot, with frame-tagged refs | M | M6-11 child frames, shadow roots, M6-11b |
| browser-control 9 | Cap screenshots at 1568 px, default to JPEG and allow an element crop | S | M6-11 JPEG, 1,568 px, element crop |
| browser-control 10 | Offer screenshots with numbered boxes that match the snapshot refs | S | M7-1 |
| browser-control 11 | Add a batch tool that runs several actions in one call and stops on the first failure | S | M7-1 |
| browser-control 12 | Expose the tools a page registers through WebMCP, with their annotations | M | M7-1 (spike first) |
| browser-control 13 | Let the agent read, answer and resolve the user's point-to-comment notes, and mark the user's selection in the snapshot | M | M7-2 |
| browser-control 14 | Tell the agent when a pane crashes or hangs instead of letting every call time out | S | M6-11 crashes are reported |
| browser-control 15 | Reuse one isolated world per document and widen wait_for | S | M7-1 |
| browser-control 16 | Lend a login from a user pane to an agent pane for one origin, by explicit approval | M | Left out: security line, Wasif decides |
| browser-control 17 | Mark read-only and consequential tools in tools/list | S | M6-11 tool hints |
| browser-control 18 | Add a read tool: page text with a search filter and no new dependency | S | M6-11 read tool |
| browser-control 19 | Tag nodes that are covered or off screen so the agent skips dead targets | S | M7-1 |
| browser-control 20 | Record every browser tool call as an append-only audit row and show it as a timeline on the pane | M | M6-12 audit timeline |
| browser-pane 1 | Detect the dev server from terminal output and open it as an owned preview | S | M6-3, D60 |
| browser-pane 2 | Send a picked element as a bounded, sanitised, labelled-untrusted payload | M | M6-13 picked element, 4 KB, labelled untrusted |
| browser-pane 3 | Resolve a picked element to its component and source file:line | L | M7-2 |
| browser-pane 4 | Keep comment threads on the page with status and agent replies | L | M7-2 |
| browser-pane 5 | Add a responsive mode with device profiles, drag handles and fit-to-pane scale | M | M7-3 |
| browser-pane 6 | Let OAuth popups keep their opener, and stop pages spawning panes without a click | M | M6-13 OAuth popups keep opener, no pane without a click |
| browser-pane 7 | Show a real load-error page, a certificate prompt and a crash state | M | M6-13 load error, certificate, crash pages |
| browser-pane 8 | Redact credentials and cap images before browser output reaches the agent | S | M6-12 scrubbed output |
| browser-pane 9 | Mark up a screenshot with arrows, boxes and text, then send it with the comment | M | M7-2 |
| browser-pane 10 | Walk the element stack with arrow keys before sending a pick | S | M6-13 arrow keys walk the element stack |
| browser-pane 11 | Add a rendering-conditions menu from CDP Emulation (dark mode, reduced motion, vision, throttling) | S | M7-3 |
| browser-pane 12 | Pick inside cross-origin iframes with auto-attached frame sessions | L | M6-11 same-origin; cross-origin in M7-2 |
| browser-pane 13 | Re-arm CDP state when the debugger detaches, and dock DevTools instead of a loose window | S | M7-1 |
| browser-pane 14 | Reload a visible pane when its session finishes a turn | S | M7-3 |
| browser-pane 15 | Overlay a reference image on the live pane with a drag divider | M | M7-3 |
| browser-pane 16 | Scope a Firefox identity to Google sign-in hosts so OAuth works in the pane | S | Left out: identity spoofing, Wasif decides |
| core-services 1 | Take the single-instance lock before touching the database | S | M6-4 one core only, M6-04a |
| core-services 2 | Stop re-raising a missed schedule every 30 seconds, and give each schedule a catch-up policy | S | Moved with the pipelines (D53) |
| core-services 3 | Let terminals outlive a core upgrade with version-sliced pty host generations | L | Left out: second long-lived process, Wasif decides |
| core-services 4 | Make settings writes safe: refuse an unparsable file, write atomically, check it did not change | S | M6-4 settings, M6-04b |
| core-services 5 | Return a core identity from ping and detect a stale core | S | M6-4 stale core visible, D63 |
| core-services 6 | Watch the core with a crash-loop cap and show why a start failed | S | M6-4 restart owner: 3 in 60 s, last 20 log lines |
| core-services 7 | Replace the ALTER-if-missing chain with numbered migrations and a history table | M | M6-4 numbered migrations |
| core-services 8 | Declare each pipe method once, with params, and generate the CLI listing and skill from it | M | M6-17 one method list |
| core-services 9 | Prune event and command rows on a retention window | S | Left out: deletes data by default, Wasif decides |
| core-services 10 | Label sandbox containers, add --init, and sweep orphans at start | S | M7-5 |
| core-services 11 | Mask token-shaped strings with keyword-gated rules before they reach the screen, logs and notifications | M | M7-5 |
| core-services 12 | Checkpoint the WAL by size first and read the result | S | M7-5 (result read; 30 s TRUNCATE kept) |
| core-services 13 | Pick dev-server ports by trying to bind, and treat access denied as taken | S | M7-5 |
| core-sessions 1 | Use Codex's own hooks (PermissionRequest, Interrupt, Stop, SessionStart) instead of notify plus file guessing | M | M6-5 Codex hooks |
| core-sessions 2 | Give Gemini real state, a session id and usage through its hooks and a per-session settings path | M | M6-5 hooks; usage in M7-6 |
| core-sessions 3 | Install Claude hooks by CLI version and add StopFailure, PermissionRequest and PostToolUseFailure | S | M6-5 by version; StopFailure in M6-23 |
| core-sessions 4 | Persist the terminal screen when a session ends or the core stops, and show it on the dead card | M | M6-6 last screen saved |
| core-sessions 5 | Resume all interrupted sessions with stagger, jitter, an in-flight cap and an auth circuit breaker | M | M6-6 resume: stagger, jitter, auth breaker |
| core-sessions 6 | Add a bounded session.wait call so Claude and scripts can block until a state is reached | S | M6-17 session.wait |
| core-sessions 7 | Read Claude and Gemini limits on demand by running a throwaway probe, with a spawn throttle | M | Left out: uses his OAuth token and an undocumented endpoint, Wasif decides |
| core-sessions 8 | Treat a limit reading as expired once its reset time has passed | S | Usage limits: past reset shows as expired |
| core-sessions 9 | Project when the current window will run out from the usage slope | S | M6-24 early-end warning |
| core-sessions 10 | Resolve a Claude Stop by its background_tasks types and add a fallback timer | S | M6-23 background work |
| core-sessions 11 | Hand a session to another engine as a handoff document when a limit stops it | L | M7-4 |
| core-sessions 12 | Keep user-supplied regexes out of the session watcher: length cap and nested-quantifier reject | S | M7-5 |
| core-sessions 13 | Repair stale MetaTrooper hook entries at core start and never write over a newer install | S | M7-5 |
| core-sessions 14 | Finish a kill on Windows with taskkill /T /F after the pty kill | S | M7-6 |
| wall-layout 1 | Move focus between tiles by direction, from the rectangles the wall already computes | S | M6-9 Alt+arrow |
| wall-layout 2 | Label every tile with a key and jump (or swap into the big slot) with one press | S | M6-9 Alt+N labels |
| wall-layout 3 | Add a focus-steal policy so a pane that needs you never takes the big slot while you are typing | S | M6-9 focus-steal rule |
| wall-layout 4 | Resize with a preview line and commit on release, because every resize reflows an agent TUI | M | M7-7 |
| wall-layout 5 | Keep layout as a few bias numbers that survive adding and removing tiles | S | M6-6 saves sizes; fractions in M7-7 |
| wall-layout 6 | Rank palette results with word-boundary fuzzy scoring and recency-weighted use | S | M7-7 |
| wall-layout 7 | Cross-fade from a snapshot of the old tile while the terminal reflows to its new size | M | M7-7 |
| wall-layout 8 | Snap a dragged tile to a one-line bar when it is pushed below its minimum size | M | M7-7 |
| wall-layout 9 | Pick the layout from the number of live panes and stop auto-layout once you have moved something | M | M7-7 (opt-in) |
| wall-layout 10 | Return to the previous tile with one key (Alt+Tab for the wall) | S | M6-9 Alt+Backspace |
| wall-layout 11 | Describe the wall as a small JSON tree of splits with pure update functions | L | Cut: only if M7-7 fractions prove too thin |
| wall-layout 12 | Drag a tile header onto another tile: edge drops pair it beside, centre drop swaps | M | M7-7 |
| wall-layout 13 | Roll the overflow of fold bars into one stack with a single open member | S | M7-7 |
| wall-layout 14 | Add a wall key layer so Ctrl+K, Ctrl+G and Ctrl+B stop fighting the agent's terminal | M | M6-9 Alt keys (different mechanism, same goal) |
| wall-layout 15 | Pick where a newly started agent lands: big slot, side column, or by policy | S | M7-7 |
| wall-layout 16 | Do not let the wheel scroll an unfocused tile | S | M7-7 |
| wall-terminal 1 | Tell both xterm instances they sit on ConPTY (windowsPty) | S | M6-7 windowsPty |
| wall-terminal 2 | Let core answer terminal queries when no tile is attached | S | M6-7 core answers queries, M6-07b |
| wall-terminal 3 | Pace each tile with byte credit and resume by offset, not drop and re-snapshot | M | M6-7 byte credit |
| wall-terminal 4 | Give WebGL to the busiest tiles only, with an LRU pool and DOM fallback | M | M6-7 WebGL for 4 tiles |
| wall-terminal 5 | Stop streaming output to folded tiles; repaint from the headless snapshot on unfold | M | M6-7 folded tiles get no stream |
| wall-terminal 6 | Paste a clipboard or dropped image as a file path inside a bracketed paste | S | M6-8 image paste |
| wall-terminal 7 | Make Shift+Enter a newline and multi-line paste safe in agent tiles | S | M6-8 Shift+Enter; paste in M7-8 |
| wall-terminal 8 | Launch shells with prompt-mark integration and read OSC 133/633 in the headless term | M | M7-8 (opt-in) |
| wall-terminal 9 | Link file paths, path:line:col and boxed or wrapped URLs; validate before underlining | M | M6-8 links |
| wall-terminal 10 | Batch pty output with a leading-edge flush before it crosses the pipe and IPC | S | M7-8 |
| wall-terminal 11 | Read progress, cwd and notification escapes in the headless term as tile status | S | M7-8 |
| wall-terminal 12 | Resize on the leading edge and coalesce the burst, with a short trailing flush | S | M7-8 |
| wall-terminal 13 | Copy or attach the last command's output using prompt zones, capped head and tail | M | M7-8 |
| wall-terminal 14 | Load the Unicode graphemes addon on both terminals so emoji and CJK keep one width | S | M7-8 |
| wall-terminal 15 | Search inside a tile and across all tiles' scrollback | S | M6-19 across tiles; Ctrl+F in M7-8 |
| wall-terminal 16 | Screen-reader mode on the focused tile only, with bounded polite announcements | S | M7-8 (setting, off by default) |
| wall-terminal 17 | Offer a compose box for shell tiles that hands keys back while a command runs | L | Cut: low confidence, agent tiles cannot use it |
| wall-terminal 18 | Keep the viewport anchored when an agent clears scrollback and repaints | S | M7-8 (test first) |
| agent-cursor 1 | Plan each cursor move once as timed samples, play by clock, click at arrival | M | M6-18 flow: plan once, play by clock |
| agent-cursor 2 | Scale glide time by distance and target size, with a hard cap that fits the 300 ms budget | S | M6-18 timing formula |
| agent-cursor 3 | Fire the input at arrival and run ripple, caption and typing visuals off the critical path | S | M6-18 input at arrival, visuals after |
| agent-cursor 4 | Keep one cursor per agent session with its own colour, label chip and z-order | M | M6-18 one cursor per session |
| agent-cursor 5 | Use a transparent, non-focusable, click-through Electron window for the desktop overlay | M | M6-18 host 2 overlay window |
| agent-cursor 6 | Pin the overlay just above the target window, never in the always-on-top band | M | M6-18 z-order |
| agent-cursor 7 | Keep the overlay out of the agent's screenshots with display affinity, and wait a frame | S | M6-18 content protection |
| agent-cursor 8 | Refit the overlay to the target window and display on a short timer, with DPI done in our code | M | M6-18 desktop placement, DPI |
| agent-cursor 9 | Fade idle cursors, snap on big jumps, and honour reduced motion | S | M6-18 idle fade, snap, reduced motion |
| agent-cursor 10 | Draw from a cursor feed so cua-driver actions need no per-tool hook | M | Left out: needs cua-driver (computer-use best 1) |
| agent-cursor 11 | Show a one-line action caption next to the cursor, redacting typed values | S | M6-18 caption, typed text never shown |
| agent-cursor 12 | Add arc deflection and (optionally) overshoot for the human preset only | S | M6-18 human preset |
| agent-cursor 13 | Use spline interpolation only if cursors are streamed to another screen | S | Cut: only for cursors streamed to another screen |
| core 1 | Drive process-engine state from the terminal title | M | M6-5 title states |
| core 2 | Keep a permission wait sticky until its own tool resumes | S | M6-5 sticky permission wait, M6-05c |
| core 3 | Infer an interrupt from Escape input plus a title change | M | M6-23 interrupts |
| core 4 | Pause the pty when the headless terminal falls behind | S | M6-7 pty pause at 1 MB |
| core 5 | Use bundled ConPTY and warm it at boot | S | Left out: native binary, Wasif decides |
| core 6 | Auto-continue a session after its usage limit resets | M | M6-24 resume at reset |
| core 7 | Ship tiny state-reporter plugins for opencode and pi | M | M6-23 opencode; pi in M7-6 |
| core 8 | Make notifications presence-aware | S | M6-10 focus rule; rest in M7-6 |
| core 9 | Replace stash-create turn bases with hidden-ref checkpoints | M | M7-6 |
| core 10 | Confirm a typed prompt took, and say who is blocking it | S | M7-6 |
| core 11 | Scan for known fatal messages, then confirm with a stall check | S | M6-23 fatal patterns |
| core 12 | Close an agent with an exit ladder, not a kill | S | M7-6 |
| core 13 | Copy ignored config files into a new worktree safely | S | M7-6 (opt-in) |
| core 14 | Treat a Stop with pending background work as a pause | M | M6-23 background work |
| browser angle 1 | One browser per agent, and no agent can touch another's | S | pane model, rule 8 |
| browser angle 2 | No debug port, no extension, no focus stealing, works on Windows | S | pane model: no debug port, no extension |
| browser angle 3 | The agent says 'I need you to log in', you do it, it carries on | M | M6-12 handoff |
| browser angle 4 | Point at the page, the agent answers on the page | M | M6-13 picks; threads in M7-2 |
| browser angle 5 | You approve which sites the agent may reach, and see what it did | M | M6-12 origins and audit |
| browser angle 6 | Small answers: the browser tool that does not eat your context | M | M6-11 bounded output |
| browser angle 7 | Compare the page, not just look at it | M | M7-3 |
| browser angle 8 | Local pages and sign-in pages just open | M | M6-13 cert page and popups; Google sign-in left out (browser-pane 16) |
| core angle 1 | Quit the app, reboot, and every agent comes back where it was | M | M6-6 |
| core angle 2 | The card says what the agent is really doing | M | M6-5, M6-23 |
| core angle 3 | Add any CLI as an engine with a JSON file, no fork, no release wait | M | M5-14 engines as data (done), title states |
| core angle 4 | Hit the 5-hour limit and it carries on by itself | M | M6-24 |
| core angle 5 | Free, Windows-native, no account, nothing phoned home | M | D28, D72 |
| core angle 6 | One notification per real need, silent when you are already looking | S | M6-10 |
| core angle 7 | Sandbox with approval profiles, not just a worktree | L | Covered by M7-5 sandbox containers; profiles left out with the experimental sandbox |
| core angle 8 | A core that runs alone: one instance, safe restarts, drivable by CLI | M | M6-4, M6-17 |
| wall angle 1 | Never miss the agent that is waiting: one key to the oldest blocked pane, and it says why | S | M6-9 Alt+J and reason |
| wall angle 2 | The agent wall that runs natively on Windows with no login | M | D28, D72 |
| wall angle 3 | Real terminals for every agent on one wall, not rows or chat threads | M | the approved wall |
| wall angle 4 | Close the window and nothing dies: every agent and the layout come back as you left them | S | M6-6 |
| wall angle 5 | One queue for Claude, Codex and Gemini, read from hooks, never guessed from the screen | M | M6-5 |
| wall angle 6 | Quiet when I am looking, loud when I am away, and the message names the task | S | M6-10 |
| wall angle 7 | Keyboard-first wall: jump to any tile by label, move by direction, answer without the mouse | S | M6-9 |
| wall angle 8 | See what each pane is costing and how full its context is, on the tile | M | M6-20 cost, M6-25 context fill |
| computer-use best 1 | Attach cua-driver as the desktop MCP, replacing the PowerShell UIA plan |  | Left out: native binary (D71 names it as the upgrade), Wasif decides |
| computer-use best 2 | Let agents test MetaTrooper's own Electron UI |  | M6-16 |
| computer-use best 3 | Own the approval and take-over UI for computer use |  | M6-2, M6-15 |
| computer-use best 4 | Linux desktop sandbox image for risky or unattended GUI work |  | Left out: new runtime images, Wasif decides |
| computer-use best 5 | Do not build a vision stack; borrow two mechanisms only |  | Out of scope: no vision model |
| computer-use diff 1 | One approval and audit surface for every engine's computer use |  | M6-2, M6-12 audit |
| computer-use diff 2 | Computer-use steps inside readable JSON pipelines (QA a build by clicking it, then gate) |  | Moved with the pipelines (D53) |
| computer-use diff 3 | Windows-first background control that does not hijack the pointer |  | M6-15 pattern actions, no SendInput |
| computer-use diff 4 | Engine-neutral desktop tools, so the best or cheapest model can drive |  | metatrooper-desktop MCP, any engine |
