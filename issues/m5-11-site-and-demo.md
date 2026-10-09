# M5-11 Site, waitlist, demo data

Child of Milestone 5 in `spec.md`. Tag: BLOCKER (ships 2026-12-01). Effort 1.75 CC days (1.0 + 0.75).

## Current state

No `site/`, no GitHub Pages workflow. `METATROOPER_HOME` gives an isolated home (`core/src/paths.ts:17-18`). README
GIFs show the mockup, not the app.

## What to build

1. `site/index.html`, one page: the line "a PR reviewed by two engines, with proof"; first three lines Windows and
   Linux, local, no account, no telemetry; the three GIFs; Tally waitlist embed; a Pro section once M5-7 exists.
   `.github/workflows/pages.yml` deploys `site/`.
2. `tests/demo/seed.mjs`: builds a demo home under `METATROOPER_HOME`, a neutral fixture project, and finished runs
   for three GIFs (pr-review-fix with proof, a gate waiting, spec in PR out). Meters, plan names and usage limits
   are hidden in the DOM for capture (standing rule: nothing personal in screenshots).

## Acceptance criteria

- M5-11a. `page-check.py site/index.html --widths 390,1280` reports no sideways scroll and no clipped text.
- M5-11b. `node tests/demo/seed.mjs` on an empty `METATROOPER_HOME` produces the three runs, and the window opened
  on that home shows no path outside the demo folder.

## Hand-back

The Tally form, switching on GitHub Pages, recording the GIFs (about an hour).
