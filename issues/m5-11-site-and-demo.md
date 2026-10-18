# M5-11 Site and demo redone for the four parts

Child of Milestone 6 in `spec.md` (carried M5 work). Priority: High. Effort: 0.75 CC day. Depends on: M6-18 (agent
cursor). The old-scope version of this file (two-engine review, pipeline GIFs, a paid section, a waitlist embed) is
in git history before this change.

## Current state (2026-10-18, main 7a7c26f)

- `site/index.html` described the pipeline desk ("A PR reviewed by two engines, with proof") and pointed at
  `gifs/*.gif` files that never existed.
- `.github/workflows/pages.yml` deploys `site/` and runs only when started by hand (`workflow_dispatch`).
- `tests/demo/seed.mjs` on main imports pipeline code that M6-1 deleted. M6-16 has already rewritten it on its
  branch (`m6-16-self-test`: `seedDemo(home)`, two fixture sessions, a live dev server, no pipelines) and adds
  `npm run dev -- --demo` in `workbench/`. This child leaves `seed.mjs` alone; the demo home for recordings comes
  from M6-16's `--demo`.
- The agent cursor (M6-18) is on branch `m6-18-agent-cursor` with `contracts/agent-cursor.md`. Its setting
  `agent_cursor.show_in_recordings` (default false) turns off the overlay's content protection so a screen
  recorder can see the cursor.

## What to build

1. `site/index.html`, one file, inline CSS, light and dark, readable at 390 px with 16 px gutters, no external
   scripts or fonts. It covers the four parts (the wall, browser use, computer use, core services), the source
   install, plain limits and questions, and a "Watch releases on GitHub" call to action.
2. Three recording slots, at the site root: `site/wall.gif`, `site/browser-cursor.gif`,
   `site/computer-use-takeover.gif`. Each `<img>` removes its whole `<figure>` when the file fails to load, and each
   part's copy sits outside the figure, so the page reads the same with all three missing.

## Acceptance criteria

- M5-11a. `python meta/scripts/page-check.py site/index.html --widths 390,1280` (the vault's checker) reports `ok`
  at both widths.
- M5-11b. With none of the three GIFs present, the page shows no empty frame and no broken-image box.
- M5-11c. `grep -niE "pipeline|installer|troop run|\bPro\b" site/index.html` finds no claim that MetaTrooper has
  pipelines, a paid add-on or an installer.

## Hand-back (only Wasif)

1. **Record the three GIFs** once M6-16 and M6-18 are merged, with `/demo-capture`, in the demo instance only:
   - Start it with `npm run dev -- --demo` in `workbench/`. It has its own data folder and no secrets.
   - In that instance only, set `agent_cursor.show_in_recordings: true` (and `agent_cursor.mode: human` if the glide
     is too fast to read). Never set it in your real `~/.metatrooper/settings.json`: it lets screen captures see
     the cursor overlay.
   - `site/wall.gif`: four tiles, one asks a question, turns orange and moves to the big slot, you answer.
   - `site/browser-cursor.gif`: an agent's cursor glides to a Send button in a browser pane and an approval card
     appears; Approve once.
   - `site/computer-use-takeover.gif`: Give window on Notepad, the agent types with its cursor showing,
     Ctrl+Alt+Q (Control+Alt+Shift+Q in the demo instance), the tile says "paused by you".
   - Check each frame for anything personal (paths, usage meters, account names) before committing.
2. **Switch on GitHub Pages** for Wasif-ZA/metatrooper (Settings, Pages, Source: GitHub Actions), then run the
   `pages` workflow by hand from the Actions tab.
3. **Waitlist:** make a Tally form and send its link to be embedded, or keep the "Watch releases on GitHub" button
   the page has now.
