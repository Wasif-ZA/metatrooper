# M8-46: Design system: ds.css tokens, and the library choice

Part of Ouros, Milestone 8. Priority: High. Effort: not sized until M8-0. Depends on: M8-0, M8-1.
**Start on or after 2026-11-09.**

## Source of truth

- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/` (also `ouros/direction` in the wip repo): `proto/kit/ds.css`, `proto/kit/parts-next.js`, `proto/BRIEF-round3.md` "Look", `board.py` lists `STACK` and `LOOK`.
- `issues/m8-34-text-contrast-tokens-for-the-whole-kit.md`, `issues/m8-01-move-the-kit-into-the-repo-with-an-o-cla.md`.

## What it does

The approved screens use one look. It lives in `ds.css`, which loads last.
Its sizes come from shadcn/ui new-york-v4, and its tokens are neutral dark.
This issue makes that the real design system, and leaves the library choice to M8-0.
The look today is CSS in a prototype, with no library installed.

| Thing | Value in `ds.css` and the brief |
|---|---|
| Surfaces | `--c0 #0a0a0a`, `--c1 #101010`, `--c2 #171717`, `--c3 #262626` |
| Text | `--t1 #fafafa`, `--t2 #a1a1a1`, `--t3 #858585`, 12 px minimum |
| Buttons | 32 px high, 6 px corners |
| Rows | 40 to 44 px |
| Cards | 12 px corners, flat |
| Badges | Fully round |
| Colour | Orange means a person is needed. Selection is blue. Green and red only for real status or change |

## Library numbers (board.py, read 2026-11-05)

| Library | Stars | Licence | Against his gate |
|---|---|---|---|
| shadcn/ui | 127,332 | MIT | Pass |
| Tailwind CSS | 98,061 | MIT | Pass |
| Monaco | 46,949 | MIT | Pass |
| Lucide icons | 25,554 | ISC | Stars pass. Licence is ISC, not MIT |
| xterm.js | 21,317 | MIT | Below 25k. Already an exception (`spec.md` dependency table) |
| Radix | 19,467 | MIT | Below 25k. Needs the exception GSAP got |
| cmdk | 13,061 | MIT | Below 25k. Last push 2025-10-29. Needs the exception |
| react-resizable-panels | 5,452 | MIT | Below 25k. Needs the exception |

shadcn sits on Radix, so choosing shadcn means choosing Radix's exception too.
Vite is not an option. He does not accept it.

## Evidence

- His verdict in the layout round: cleaner through a real UI library.
- Board: Orca and Paperclip use shadcn/ui and Radix.

## Blocked on

- The library itself: M8-0 decides after the host. A VSCodium webview and an own renderer differ here. His call.
- An exception for each library below 25k: Radix, cmdk, react-resizable-panels. His call, one yes each.
- ISC on Lucide. His call.
- These tokens replace M8-34's values (`#e6e6e6`, `#9a9a9a`, `#808080`, surfaces from `#121212`). He approved the screens with `ds.css`, but no one has asked about M8-34 directly. His call.
- Section 1 of `ouros-spec.md` says Ouros "adds no dependency" for the drawing path. A library changes that. His call.
- `spec.md` records "no 8px rounded cards" under M8-34, and the screens use 12 px cards. His call on whether the approved screens replace that rule.

## What gets built

Not sized until M8-0.

| # | Change | Reuses |
|---|---|---|
| 1 | Tokens and sizes from `ds.css` as the kit's only source | M8-1 move, `o-` prefix |
| 2 | Fix `--t3` on `--c3`. Working below | M8-34b |
| 3 | The 17 parts in `parts-next.js` join the catalogue, each with tests in check.mjs | M8-1, M8-10 |
| 4 | The library choice written in the `spec.md` D-list with these numbers re-read at the time | M8-0, `/gh-repo-research` |

Contrast working, for `--t3 #858585`:
- On `--c0 #0a0a0a`: 5.37:1. Passes 4.5:1.
- On `--c2 #171717`: 4.86:1. Passes.
- On `--c3 #262626`: 4.10:1. Fails M8-34b's 4.5:1.

## Acceptance criteria

- [ ] M8-46a. Every approved screen in `proto/shots/` still draws correctly after the move, checked by eye and by `ncheck.mjs`.
- [ ] M8-46b. No part hard-codes a grey or a size that a token covers.
- [ ] M8-46c. Every text token meets 4.5:1 on every surface it is used on.
- [ ] M8-46d. Orange appears only for a person being needed, checked over every screen.
- [ ] M8-46e. The library choice and each exception are in the `spec.md` D-list, with stars, licence and last push.
- [ ] M8-46f. The 17 parts pass check.mjs and validate.mjs.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (`ouros-spec.md` section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained, or carry his named exception.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
