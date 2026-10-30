# M8-34: Text contrast tokens for the whole kit

Part of Ouros, Milestone 8. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-1.
Status in scratch: verdict pending (F1).
**Start on or after 2026-11-09.**

## Source of truth

- `spec.md` Milestone 8 row M8-34; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): ~/.cache/claude-scratch/ouros-explorer-2026-10-30/round-2/FIXES.md F1; BOARD.html.

## What was designed

- Round 1 secondary text was #505050 on #161616, 2.2:1.
- Tokens: primary #e6e6e6, secondary #9a9a9a, meta #808080, 12px minimum; surfaces #121212, #1b1b1b, #222, #2a2a2a; borders #2c2c2c.
- Round 2 applied it to the Explorer pane only; the real fix is the kit tokens.

## Blocked on

- F1 yes/no.

## Acceptance criteria

- [ ] M8-34a. The kit defines three text levels and no part hard-codes a grey.
- [ ] M8-34b. Every text token meets 4.5:1 on its surface.
- [ ] M8-34c. No meaningful text is under 12px.
- [ ] M8-34d. Editor and Explorer use the same tokens.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
