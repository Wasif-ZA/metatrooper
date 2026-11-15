---
name: feedback-rounds
description: Run review rounds on a document, design or set of screens through one HTML board with a comment box per item, then apply every comment and prove each one landed with a comment-to-change ledger. Use when the user says "give me a board to comment on", "apply my comments", "apply all N comments", "did you apply everything", or hands back marked-up notes, a PDF of comments or pasted feedback.
---

# feedback-rounds

The failure this prevents: comments silently skipped, or applied in spirit but not in fact.

## 1. Each round has an objective

Before a round, write one line: what this round is for ("make section 3 readable",
"match the reference spacing"). A round without one is not run. Stop after about five rounds
on the same item and ask whether to restart from a fresh direction.

## 2. Build the board

One self-contained `.html` file, inline CSS and JS, light and dark:

- One section per item (screen, page, section, figure), with the thing itself shown: an image,
  the rendered component, or the text.
- Under each, a textarea saved to `localStorage`, keyed by item id.
- A "copy all" button that copies every non-empty comment as `## <item id>\n<comment>`.
- Open it for the user, or send it to their phone if they are away.

## 3. Take the comments in

Comments come back as the copied block, a PDF, a pasted list or screenshots. Number every
distinct point, even several inside one comment. Read literal requests literally.

## 4. Apply and keep a ledger

`ledger.md`, one row per point:

| # | Point (their words) | Change made (file:line or commit) | Status |

Status is `done`, `question` (ask, do not guess) or `declined` (with the reason, only when the
point conflicts with an earlier decision). Every point gets a row. If a point names a reference,
compare against that reference, not your own earlier version.

## 5. Hand back

Report counts first ("31 of 33 done, 2 questions"), then the questions, then the board updated
with before and after for each changed item. Never say all comments are applied unless the
ledger has no empty rows.
