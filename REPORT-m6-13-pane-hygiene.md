# M6-13 Browser pane hygiene and picks: report

Branch `m6-13-pane-hygiene`, commits `64fc257` (feature) and the follow-up "Browser pane: a failed load keeps status and navigate's error" (see `git log`). The issue file has no numbered criteria, so the criteria below are
the six clauses of the spec.md "Pane hygiene (M6-13)" bullet (Browser use section). The rules are written up as
built in `contracts/browser-tools.md`, new section "Pane hygiene (M6-13)".

## Criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Load errors, certificate errors and renderer crashes show their own page | Met | `panes.ts` `did-fail-load` (main frame, not `ERR_ABORTED`) and `render-process-gone` call `showError`, which loads a `data:` page from `errorPage()`: "did not load", "is not secure" (net -200..-299), "MetaTrooper blocked this page" (-20) and "crashed". The pane URL, URL bar and tool page state keep the failed URL (`errorFor`, `pageUrl()`), and `urlChanged` never stores the `data:` URL. `status` keeps the last real page's code. `navigate` to a dead host still fails with -32099 "could not load". Other actions return `error: "the page did not load: <url>"`. Reload and Try again reload the failed URL, re-attaching the debugger after a crash (`retry()`). Test: `pane-hygiene.test.ts` checks `loadErrorPage`, `errorPageKeepsUrl` (with `status`), `navigateToDeadHostFails`, `certificatePage`, `blockedPage`, `abortAndSubframeIgnored`, `crashPage`, `reloadRetriesFailedUrl` and `errorPageEscapes`. |
| 2 | OAuth popups keep their opener | Met (unit level) | `setWindowOpenHandler` returns `action: 'allow'` for `disposition: 'new-window'`. The popup is a sandboxed child window in the opener's partition, so `window.opener` survives. `guardPopup()` blocks non-web navigation and nested windows, and `destroy()` closes the popup with its pane. Test: `popupKeepsOpener`, `popupGuarded`, `popupClosesWithPane`. Not checked against a real OAuth provider in Electron (see below). |
| 3 | A page cannot open a new pane without a click | Met | `input-event` mouse down/up or key down stamps `clickedAt`, and so do agent `click` and `type` with `submit`. A window open more than 5 s after the last click is denied and logged as `blocked`. Each click is consumed, so one click opens one window. Test: `noClickDenied`, `clickOpensOnePane`, `secondOpenNeedsAnotherClick`, `agentClickCounts`. |
| 4 | `capture()` restores the viewport override in a `finally` | Met | The restore already ran after a catch (commit `dd38f3d`). It is now a literal `finally` that still reports the capture error first. Test: existing `capture-restore.test.ts` passes. |
| 5 | A picked element is sent as at most 4 KB of sanitised HTML, labelled as page content the agent must not follow as instructions | Met | `comments.ts` `sanitiseHtml`, `capBytes` and `elementBody`. `commentSave` in `main.ts` now builds the body with `elementBody` instead of slicing 2,000 characters, and `pick()` sends up to 64 KB raw so the cut happens after sanitising. Test: `comments.test.ts` "a picked element is sanitised, cut at 4 KB on a character boundary and labelled as page content". |
| 6 | Arrow keys walk the element stack before sending | Met (unit level) | `PaneManager.walkPick(id, 'up' or 'down')` keeps `pickStack`: up goes to `parentElement` and stops below `<html>`, down pops back toward the clicked element. Each step re-sends `comment-picked` with the new path, crop and `depth`. Plumbing: IPC `panePickWalk` (`main.ts`, `preload.cjs`). In the renderer, `pickWalk()` in `app.js` handles Up and Down while the comment form is open and focus is not in a text field. After a pick, focus moves to the workbench UI so the arrows reach it, and the form shows a hint. Test: `walkUp`, `walkStopsBelowHtml`, `walkDown`, `walkDownAtClickedIsNoop`. |

The tests bite: I disabled the click gate, the main-frame guard and the `data:` URL skip one at a time, and
`pane-hygiene.test.ts` failed each time. The source was restored afterwards.

## Test command and result

```
cd workbench
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci   # the worktree had no node_modules
npm test
```

Result: tests 96, pass 60, fail 0, skipped 32, todo 4. The skipped ones are the Electron end-to-end tests
(`METATROOPER_BROWSER_E2E`, `METATROOPER_UI_REVISION_E2E`, and the missing Electron binary). I left them off on
purpose: they launch Electron and an isolated core, and this task said not to start cores.

## Left for Wasif

- **Real Electron check not done.** Everything above is tested against a mocked `electron` module. Worth a manual
  pass in the workbench:
  - a real OAuth popup (for example "Sign in with Google" on a test site), checking that `window.opener.postMessage`
    reaches the pane;
  - a bad-certificate site (`https://self-signed.badssl.com/`) and an unreachable host;
  - `chrome://crash` is blocked by policy, so a crash needs the debugger's `Page.crash` or a task-manager kill;
  - a pick followed by Up and Down in the comment form.
- **Assumptions about Electron 44:**
  - `input-event` fires for real mouse and key input in a `WebContentsView`.
  - Child windows from `action: 'allow'` inherit the opener's partition.
- **Popups have no debugger.** Agent tools cannot drive a popup, and the DNS-rebinding re-check (`connectedVerdict`)
  does not run inside it. The partition's `onBeforeRequest` address policy still applies. I wrote this down in the
  contract. If agents need to finish OAuth on their own, that is new work (attach a debugger to the child, or use
  `handoff` from M6-12).
- **Agent panes now also open popups as windows.** Before, popups loaded in place. `target=_blank` links in agent
  panes still load in place, and the contract's "As built" line now says this.
- **Sanitising is regex-based.** It runs over the outer HTML string. Entity-encoded `javascript:` URLs and malformed
  markup can get past it. The label line is the real defence; the sanitiser trims noise and obvious active content.
- **The pick walk only covers the main frame.** Elements inside child frames resolve in the main frame's isolated
  world. Cross-origin picks are M7-2.
- **Process conflict.** The issue file says "Never commit, push or open PRs from an agent; hand back the command".
  Your task prompt said to commit on this branch, so I made one commit (`64fc257`) and did not push or merge. If the
  issue rule should win, drop that commit with `git reset --soft HEAD~1`.
- **D65 does not list M6-13**, so I wrote these tests rather than Codex. No mutation run beyond the three spot
  checks above.
