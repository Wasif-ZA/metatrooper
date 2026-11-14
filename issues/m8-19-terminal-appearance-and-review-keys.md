# M8-19: Terminal, appearance and review keys

Part of Ouros, Milestone 8. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-17.
Status in scratch: approved (two-engine-r3/reconcile.md).

## Source of truth

- `spec.md` Milestone 8 row M8-19; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): two-engine-r3/reconcile.md; round-3/ide3.html?s=look|quiet|rich|bash|review|queue|rewind|follow; round-3/r3.css.

## What was designed

- Terminal: ruled prompt T1; the state strip shows state and counts only; 16px pitch; panel colour equals the editor (#161616); bash gutter shows exit marks only.
- Customize Look lives in View > Appearance and the palette, never the title bar: presets Quiet and Default, reset, and "from VS Code / Zed / JetBrains".
- Defaults: muted file icons (never orange), error lens off, bracket colours off and muted, indent guides, sticky scroll (editor only), breadcrumb symbol and scrollbar marks on, inlay hints the only V9 extra. Minimap cut.
- Review keys and per-hunk review (F2). Queue and steer (F5): one gesture, Tab to redirect, no drag reorder. Follow agent (F4): a tab-group chip plus a palette command.

## Blocked on

- M8-0.

## Acceptance criteria

- [ ] M8-19a. The terminal shows the ruled prompt with a state strip of state and counts only.
- [ ] M8-19b. Quiet changes the look in one step and reset restores Default.
- [ ] M8-19c. Error lens and bracket colours are off on a fresh install.
- [ ] M8-19d. The review key accepts or rejects the focused hunk and moves to the next.
- [ ] M8-19e. A message sent mid-run queues and Tab redirects it.
- [ ] M8-19f. Follow toggles from the tab-group chip and from the palette.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
