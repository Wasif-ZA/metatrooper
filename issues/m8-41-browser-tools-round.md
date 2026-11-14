# M8-41: Browser tools: find, hidden click targets, hostile page text, test export

Part of Ouros, Milestone 8. Priority: High. Effort: 6.5 CC days. Depends on: M7-1 (browser tools v3).
**Do not push this file until rows 3 and 4 are fixed locally: the repo is public and
this names an open hole (same rule as the `fix-*.md` specs).**

## Source of truth

- `ouros-spec.md` section "Computer use and browser use (2026-11-02)"; `contracts/browser-tools.md`; `issues/m7-01-browser-tools-v3.md`.
- Research: scratch `ouros-computer-use-2026-11-02/lanes/browser-drivers/reply.md`.

## Keep the driver

No outside driver replaces `metatrooper-browser`. Every candidate attaches by debugging port, extension, cloud session
or its own Chromium; none drives an in-process webContents. chrome-devtools-mcp's "steals window focus on every CDP
command" issue has 27 reactions, and Ouros has no such failure. Its tool list is about 1.5K tokens (estimated from
4,607 bytes of source). Doccraft measured 6,796 for Playwright MCP's, 11,079 for Chrome DevTools MCP's and 31,020 for
agent-browser's MCP server (one author's run, 2026-10-26, Opus 5.5, 19 tasks twice, all 38/38 right).

## Code to pull

| # | Change | Read it at | Licence | Days |
|---|---|---|---|---|
| 1 | `find`: search the ref'd snapshot, returning each hit's ref, ancestor path and 3 lines of context | microsoft/playwright `deb7e86` `packages/playwright-core/src/tools/backend/find.ts#L19-L125` | Apache-2.0 | 0.5 |
| 2 | Refs for click targets with no accessibility role (`cursor:pointer`, `onclick`, `tabindex`). Use `Runtime.callFunctionOn`, not its temporary DOM attribute, so the page is not changed | vercel-labs/agent-browser `5868f7c` `cli/src/native/snapshot.rs#L278-L290`, `#L940-L1060` | Apache-2.0 | 1 |
| 3 | Mark or drop hidden text (near-zero opacity, sub-pixel font, off-screen, matching colours, clip) and injection-looking ARIA labels before `read` and `snapshot` return | garrytan/gstack `83ae96e` `browse/src/content-security.ts#L1-L100` | MIT | 1 |
| 4 | Wrap page-derived output in a fresh-nonce fence. agent-browser's README says this is a cue, not a boundary, so it ships only with row 3 | vercel-labs/agent-browser `5868f7c` `README.md#L186` | Apache-2.0 | 0.5 |
| 5 | `read` as markdown through `Runtime.evaluate`, for research agents | h4ckf0r0day/obscura `8534b40` `crates/obscura-cdp/src/domains/lp.rs#L1-L22` | Apache-2.0 | 1 |
| 6 | Record each action's role-and-name locator (never typed text) and export a Playwright test | microsoft/playwright `deb7e86` `packages/playwright-core/src/tools/backend/snapshot.ts#L60-L100` | Apache-2.0 | 1.5 |
| 7 | WebMCP rule for M7-1 change 7: announce on change only, 16 tools and 4 KiB at most, ignore a page's `readOnlyHint` | vercel-labs/agent-browser `5868f7c` `README.md#L165-L186` | Apache-2.0 | 0.25 |
| 8 | Auto-accept `alert` on agent panes only. Not `beforeunload` on a user pane, where it can discard the user's data | vercel-labs/agent-browser `5868f7c` `README.md#L457` (docs read, code not) | Apache-2.0 | 0.25 |
| 9 | A short skill with the select, dialog, frame and handoff rules | browser-use/browser-harness `0727ae7` `SKILL.md`, `interaction-skills/` (benefit unmeasured) | MIT | 0.5 |

## Acceptance criteria

- [ ] M8-41a. `find` on a fixture returns the right ref in fewer tokens than a whole snapshot, measured with `meter.ts`.
- [ ] M8-41b. A `div` with `cursor:pointer` and no role gets a ref, and the page's DOM is unchanged afterwards.
- [ ] M8-41c. A fixture with white-on-white and `opacity:0` instructions reaches the agent with them dropped or marked.
- [ ] M8-41d. A recorded click-through exports a Playwright test that passes, with no typed text in it.

## Rules that bind every child

- Codex writes the tests for any part Claude builds, and the other way round.
- Record any mechanism taken from an Apache-2.0 source in `THIRD_PARTY_NOTICES.md`.
- No em dashes; comments say what the code does, not why.
