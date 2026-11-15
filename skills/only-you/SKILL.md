---
name: only-you
description: Do every task the agent can do itself, then hand the user one short list of what only they can do (logins, payments, secrets, sends, approvals, physical steps), each with a step-by-step guide readable on a phone. Use when the user asks "what can only I do", "do all my hand-back items", "what's left for me", or at the end of an unattended run.
---

# only-you

The user's time is the scarce part. Shrink their list to what truly needs them, then make each
item take as little thought as possible.

## 1. Sort every open item

For each item, ask: can I finish it with the tools I have, without a secret, a payment, a
login, or sending something under the user's name?

- **Yes**: do it now. Do not list it.
- **Partly**: do everything up to the step that needs the user, then list only that step.
- **No**: list it.

Things that always need the user: signing in through a browser, entering passwords or keys,
paying, sending email or messages, publishing or deploying, merging to a shared branch,
anything signed, and anything they have not approved before.

## 2. Write the list

One self-contained HTML page (or Markdown if the user prefers), readable on a phone:

- Ordered by deadline, then by how much it unblocks.
- Each item: what and why in one line, then numbered steps with the exact link, button text,
  value to paste and expected result. Pre-fill every value you can.
- Put secrets as names only (`STRIPE_KEY`), never values. Write an `.env.example` naming them.
- Estimate each item's time from the steps ("about 3 min").

## 3. Close out

Tell the user what you finished yourself in one line, then give the list. Send the page to their
phone if they are away from the computer.
