# M6-11: Browser tools version 2

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical. Effort: 4.0 CC days. Depends on: M6-1.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-11, and every section that names M6-11.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-11a. Two snapshots of an unchanged page give the same refs; after one element is removed its old ref fails with "no longer on the page" and `since_last` lists it as removed; after the frame navigates, every old ref in that frame fails.
- [ ] M6-11b. A fixture page with a same-origin iframe and an open shadow root shows controls from both, and clicking a frame-tagged ref clicks inside the frame.
- [ ] M6-11c. A 4,000-token budget on a 20,000-node fixture returns at most 4,000 tokens and a `continue` cursor that returns the rest.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
