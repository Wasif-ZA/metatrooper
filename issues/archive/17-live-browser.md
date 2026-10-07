# Live browser

Part of the MetaTrooper epic. Milestone 1. Effort: about 5 Claude Code days.

Depends on: child #12, child #16.

## What

Live browser: panes, `metatrooper-browser` MCP, browser pipe with ownership checks, cursor overlay, request interception, isolated `evaluate`, full-page capture, point-to-comment, before/after

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: browser-tools.md, pipe-protocol.md (browser methods).
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M1-09. `Get-NetTCPConnection -State Listen` shows no port owned by the core, workbench or `metatrooper-browser`, and no connection upgrades to WebSocket, during a full `two-engine-review` run.
- [ ] M1-22. Fan-out 3 on the fixture repo gives 3 worktrees, 3 leased ports starting at 3001 (skipping a port the test occupies), and 3 browser panes; each pane is drivable only by the session found through its own process ancestry, including for Codex sessions.
- [ ] M1-23. The cursor overlay reaches within 5 px of a click point before the click lands, from Claude, Codex and agy sessions.
- [ ] M1-24. Browser interception blocks `file:`, a loopback port the project does not own, `192.168.x.x`, `[::1]` on an unowned port, a `fd00::` address, and a test hostname that resolves to `127.0.0.1`, including requests made by page scripts and by `evaluate`.
- [ ] M1-25. Full-page capture of a 5,000 px fixture page with a sticky header produces one image 5,000 px tall with the header shown once.

Status 2026-09-29: built, not yet tested by Codex, so every box stays open. Throwaway runs on Linux under Xvfb:
a 3-way fan-out with fake engines driving their panes through `metatrooper-browser` gave 3 worktrees, ports
3002 to 3004 with 3001 occupied, 3 panes each refused to the other sessions (-32030), the cursor within 2 px
of every click point before the click, every M1-24 case blocked from `evaluate` and from page scripts, and a
full-page capture of a 5,000 px sticky-header page as one 1265 by 5,000 image. The Browser tab's new pane,
navigation, before/after at 390 and 1280 px, compare, and point-to-comment (selector, HTML, crop, comment row)
worked through the real window. Still to do on Windows: M1-09 (`Get-NetTCPConnection`), ancestry through
`Get-CimInstance` for Claude and Codex sessions, and M1-23 for agy once its MCP config is known.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.
