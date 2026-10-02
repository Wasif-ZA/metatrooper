# M2 status ledger

Branch m2, from main at 83a6de2 (M1 merged locally 2026-10-02). Started 2026-10-02 on Wasif's instruction while the
adoption gate (spec.md, A-01 to A-05) runs in parallel; the gate is not cleared. Status values as in M1-STATUS.md.

Order: #8 variants, then #30 diff annotation, then #7 inspiration board if it can run on a fixture without an Exa key.
Waiting on Wasif: #27 (herdr not installed), #28 (SignPath account), #32 (Docker Desktop not running), and #14, #23,
#25 (need #7 and #8 first).

| Criterion | Status | Evidence / notes |
|---|---|---|
| M2-01 | TODO | per built-in, lands with #14, #23, #25 |
| M2-02 | VERIFIED-WINDOWS | 2026-10-02T16:43+10:00: workbench/test/board.test.ts (opt-in METATROOPER_BROWSER_E2E=1 and METATROOPER_NETWORK_E2E=1, by Claude): installs plugins/agent-reach, runs inspiration-board on the bakery brief with the real workbench open; at least 8 board_item rows with capture files over 1 KB, 24 s. The plugin needs the real USERPROFILE (mcporter reads its exa config there), so the test isolates only METATROOPER_HOME. Seen: the GitHub half returned nothing for this brief (derived query `calm landing local`), so all references were web. Directions and their gate belong to design-variants (#14). |
| M2-03 | TODO | #8 in progress: combine built, grid and picked-variant hand-back built; runner tests by Codex pending |
| M2-04 | TODO | #27, needs herdr |
| M2-05 | VERIFIED-WINDOWS | 2026-10-02T16:46+10:00: core/src/limits.ts reads the last rate_limits from the newest ~/.codex/sessions file every 60 s into limit_reading (5h and weekly, used %, reset time); Claude from the statusline capture (5h and weekly), unavailable when there is none. core/test/limits.test.ts (4, by Claude): newest Codex file wins, last reading wins, no source gives unavailable and no number, Claude file parsed. Real box: codex 5h 21% weekly 30%; claude 5h 19% weekly 39%. Workbench header usage bar shows per window with reset countdown, a warn chip at 80%, or "usage unavailable". Account switcher half of #29 not built. |
| M2-06 | VERIFIED-WINDOWS | 2026-10-02T16:40+10:00: core/test/sessions-and-hooks.test.ts M2-06 (by Claude): a diff-line and a file comment built by workbench/src/comments.ts reach a Claude session through the real UserPromptSubmit hook, in order. workbench/test/diff.test.ts: diff line numbers (new-file for added and context, old-file for removed). UI glue (hand-back line click form, drop on session card via webUtils.getPathForFile) not driven by a test; the renderer loads in the real-Electron M1-11 test. Clipboard half not asserted (would overwrite the user's clipboard). |
| M2-07 | TODO | #28, needs SignPath |
| M2-08 | TODO | #32, needs Docker |
| M2-09 | TODO | #32 |
| M2-10 | TODO | #32 |
| M2-11 | TODO | #32 |
| M2-12 | TODO | #32 |

## Decisions
- 2026-10-02: Combine starts a fresh worktree from the project HEAD; the agent gets the note, each chosen variant's
  diff (against its merge-base with HEAD, new files included) and its pane capture (Wasif's call).
- 2026-10-02: Claude limits come from the statusline input (Wasif's call). core/statusline.js saves its rate_limits
  to ~/.metatrooper/claude-limits.json. It is chained through ~/.kickbacks/cli-prev-statusline.json because the
  kickbacks ad tool rewrites the statusLine in ~/.claude/settings.json; that file is setup on this box, not in git.
- 2026-10-02: a picked variant's hand-back shows `git diff <merge-base>` in its worktree and drafts
  `git -C <worktree> commit -am`, so untracked files stay listed and unstaged, as in the M1 tray.

## Log
- 2026-10-02T16:35+10:00: #8 started. runner.combine (variant.combine), PaneCapture hook wired in main.ts, raw
  prompts for combine steps; workbench Variants panel (tiles with engine, tokens, status, Pane, Pick, Discard with
  confirm, Combine with note); hand-back shows the picked variant's worktree diff (handback.ts base/cwd, merge-base
  added to the read-only git verbs). handback.test.ts M2-03 test by Claude. core 98 pass, workbench 7 pass.
