# M8-26: Agent workflow additions from the top-12 research

Part of Ouros, Milestone 8. Priority: Medium. Effort: not sized (sized after M8-0). Depends on: M8-17, M8-3.
Status in scratch: decided as "already designed"; some not drawn.
**Start on or after 2026-11-09.**

## Source of truth

- `spec.md` Milestone 8 row M8-26; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): research/next/FEATURES.md #2, #3, #5, #6, #8-#11; NEWFEATURES.html section C.

## What was designed

- Plan gate with inline comments, as a decision row that opens in the Review tab (M8-F5 covers only clarify).
- Second-engine pre-review: a button in the Review tab; findings land as inline comments.
- Real forms for agent questions (feeds M8-3). Pop a tile out to its own window.
- Add any ACP agent from the new-tab menu. Run configs become agent verbs.
- Preview pane with the agent's browser run recorded and a film strip in Review.
- Scheduled and looped runs as dimmed tiles with results to the inbox. Next candidate: a side question that does not derail the run.

## Blocked on

- NEWFEATURES.html: confirm which section C items are drawn.

## Acceptance criteria

- [ ] M8-26a. A plan takes inline comments and the agent reads them before running.
- [ ] M8-26b. The pre-review button runs the other engine on the diff and shows findings inline.
- [ ] M8-26c. A popped-out tile keeps its live state.
- [ ] M8-26d. A scheduled run shows as a dimmed tile and posts its result to the inbox.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
