# M5-7 Pro: licence key, trial, checkout, where Pro code lives

Child of Milestone 5 in `spec.md`. Tag: BLOCKER (ships 2026-12-01). Effort 2.5 CC days after Wasif's two decisions.

## Current state, verified 2026-10-09

No code: grep for `lemon`, `licence_key`, `license_key` over core, workbench, pipelines, plugins and sdk returns
nothing. Plugins never link AGPL code (spec "Open core, licence, prior art").

## Decisions only Wasif makes (hand-back, before build)

1. Where Pro code lives. Recommended: a separate plugin in a private repo with its own licence (`pro-review`),
   installed by the key screen, so the key is not one deleted line in public AGPL code. The alternative, Pro inside
   the public repo, makes the key an honour system.
2. Licence check. Recommended: Lemon Squeezy licence keys with one user-triggered activation call, cached, and
   documented as the second network exception beside wpad. The alternative is offline Ed25519 keys (`node:crypto`,
   public key in the app), which needs something to sign each key at purchase.
3. Lemon Squeezy store, A$19 monthly product with a 14-day subscription trial, tax and payout (his ABN and bank).

## What to build (once decided)

- Key entry screen (Settings, Pro): paste key, Activate, shows plan and renewal date; Deactivate frees the seat.
- Activation result cached in `~/.metatrooper/pro.json` (instance id, key hash, expiry); re-checked only when the
  user presses Refresh or the cached expiry passes. No background calls.
- The runner refuses to start `pr-review-fix` without a valid cached licence (`-32041 pro licence required`), and
  the gallery card shows "Pro" with a Buy link to the checkout URL.
- Trial uses Lemon Squeezy's own subscription trial, so a trial key is a normal key and no local clock exists.

## Acceptance criteria

- M5-07a. Starting `pr-review-fix` with no `pro.json` returns -32041 and opens nothing.
- M5-07b. A test-mode Lemon Squeezy purchase gives a key that activates and unlocks the run.
- M5-07c. With the network blocked, a cached valid licence still unlocks; an expired one does not.
- M5-07d. The no-network test (`workbench/test/no-network.test.ts`) still passes when Pro is not activated.
