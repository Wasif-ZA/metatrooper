# M8-49: Computer use in real runs: phone grants, file upload without a picker, exact click points

Part of Ouros, Milestone 8. Priority: High. Effort: 6.5 CC days. Depends on: M8-27 (phone pairing) for row 1,
M8-38 row 1 (the benchmark) for row 4. Extends M6-15, M6-12, M8-40.
**Start on or after 2026-11-09. Draft: not committed, not filed.**

## Source of truth

- `contracts/desktop-tools.md`, `contracts/browser-tools.md`, `contracts/approvals.md` as built on `ouros/build-1110`.
  If this file and a contract disagree, the contract wins until this child changes it.
- Research: scratch `computer-use-2026-11-16/REPORT.html` (27 failures from 4 real sessions, 2026-11-07 to 2026-11-16,
  ranked fixes, practitioner sources).

## What went wrong in real use

- Across three days the desktop tools did no input. `windows` was called 7 times: 5 calls returned an empty list and 2
  hit a permission-check error. A grant can only be made from the workbench, and on the last day the user was away from
  the PC. The agents then drove the browser with an outside CLI using real pointer input, outside grants and approvals.
- 14 of 27 failures were web forms driven as desktop windows: a native file picker that could not be filled, fields with
  no UI Automation value, keys refused for want of the foreground.
- One coordinate click picked the wrong radio button. The point had been estimated from a screenshot.

## What it does

| # | Change | Gap today | Days |
|---|---|---|---|
| 1 | **Phone grants.** A new agent tool, `request_grant {title_hint, reason}`, raises a card on the paired phone (M8-27) and on the workbench. The card lists the matching `grant.candidates` with title, exe and pid. Approve calls `grant.window` over the phone's paired channel, which no agent process can reach. The phone card also carries Pause, which calls `takeover.pause`, so input still goes only while the user can stop it (D43, F10). | "Made only from the workbench", so nothing can be granted while the user is away | 2.5 |
| 2 | **Browser `upload {pane_id, ref, paths}`.** On an `<input type=file>`, `DOM.setFileInputFiles` through the pane's debugger. On a button that opens a chooser, `Page.setInterceptFileChooserDialog` plus `Page.fileChooserOpened`, then the same call. No native dialog ever opens. Each path must sit under a root the user allowed. The approval card names each file and its size, and asks every time. | No upload tool; a click on an upload button opens a native dialog no tool can see | 1.5 |
| 3 | **Desktop `choose_file {window, path}`** for a granted standard file dialog (`file_dialog: true`). It finds the Edit inside the File name ComboBox, sends `WM_SETTEXT`, reads it back with `WM_GETTEXT`, then sends `BM_CLICK` to the default button. These are window messages only (D78), and it asks every time (D61). | Filling a dialog takes a snapshot, then a `type` into the right one of three "File name" nodes, then a click; the dialog's tree reads slowly | 1 |
| 4 | **Exact click points.** A read-only `locate {window, ref}` returns `{screen_rect_px, window_rect_px, dpi, monitor}`. `screenshot` also returns `{origin_px, scale}`, so any pixel in the image maps exactly to the screen. Input stays pattern and message based (D78). This feeds the cursor glide target now, and M8-40 row 8 if coordinate clicks are ever added. | A screenshot carries no mapping to the screen, so a point read off it is a guess | 1.5 |

## Measured, not assumed

- Row 3: in one real run the browser's open dialog had the browser's own pid, which fits the owner rule in Grants. The
  `GW_OWNER` chain itself was not read. Measure it at build time for Chromium and Electron hosts before relying on it.
- Row 4: the screen in that run had a second monitor at a negative origin. The fixture must cover two monitors with
  different scaling and a negative origin.

## Not built here

- Driving signed-in sites in the user's own browser profile. Chrome 136 and later ignore remote debugging on the default
  profile (developer.chrome.com/blog/remote-debugging-port), so row 2 works in Ouros panes, where the user signs in through handoff (M6-12).
- Real pointer input of any kind (D78).

## Blocked on

- M8-27 pairing, for row 1's channel.
- A design grill for the phone grant card before its screen is drawn (design gate). This file fixes the mechanism only.
- The user's yes on changing the "made only from the workbench" rule in `desktop-tools.md` to "made only from a trusted
  UI: the workbench or a paired phone".

## Acceptance criteria

- [ ] M8-49a. With the workbench minimised and no one at the PC, `request_grant` raises a phone card; Approve makes a grant that `windows` lists within 2 s; Reject returns "not approved: the user rejected this action".
- [ ] M8-49b. No process reachable from an agent session can call the phone approval path; a forged call from a session process returns -32003.
- [ ] M8-49c. Pause on the phone card stops a 2,000-character `type`, with no further character landing after the acknowledgement, as in M6-15b.
- [ ] M8-49d. `upload` attaches 2 files to a fixture form in a background pane, opens no native dialog (no new top-level window appears), and the page's `change` handler sees both names.
- [ ] M8-49e. `upload` with a path outside the allowed roots returns an error and sends nothing.
- [ ] M8-49f. `choose_file` fills and confirms Open and Save As dialogs from Notepad and from a Chromium page, with the pointer unmoved (benchmark sentinel).
- [ ] M8-49g. Measure first: on the two-monitor fixture, `locate`'s centre for 10 known controls is within 2 px of the controls' own rects; the same holds for points mapped from `screenshot` with `origin_px` and `scale`.

## Rules that bind every child

- **Start on or after 2026-11-09.** This file is a spec, not a go.
- Codex writes the tests for any part Claude builds, and the other way round.
- The repo is public: evidence here stays generic; the per-run detail stays in the scratch report.
- Never commit, push or open PRs from an agent; hand back the command.
- No em dashes; comments say what the code does, not why.
