# M8-18: Editor and navigation that know about agents

Part of Ouros, Milestone 8. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-17.
Status in scratch: decided (two-engine/reconcile.md final column).
**Start on or after 2026-11-09.**

## Source of truth

- `spec.md` Milestone 8 row M8-18; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): two-engine/reconcile.md N1-N11, E1-E3; round-2/ide2.html.

## What was designed

- Explorer: one agent dot per touched file, no folder rollup; an "Agent changes" toggle.
- Quick Open has groups and a preview; a leading `?` switches to meaning search, never on its own and with no reason tags.
- Tabs: the agent dot replaces the modified dot and clears on Allow; agent-opened tabs get a single-row group chip.
- Breadcrumb dropdown gets dots and +/- only. A pending hunk is a dashed orange gutter bar with Keep / Reject, no tint.
- Blame reads "claude · run 3 · 2 min ago". The Review tab stacks files with Keep all / Reject all; no Viewed boxes, no line comments.
- Cut or deferred: N3 filter row, N11 breadcrumb chip, N9 tab auto-archive, N6 `@` index (waits for meaning search).
- 2026-11-05: "no line comments" above is reversed by the approved screen `n05-diff-comment.json`: see M8-F18. New Review layout: `n22-review.json`, shot `r-review.png`, in `~/.cache/claude-scratch/ouros-direction-2026-11-05/proto/`.

## Blocked on

- M8-0.

## Acceptance criteria

- [ ] M8-18a. A file an agent touched shows a dot that clears after Keep or Reject.
- [ ] M8-18b. Quick Open groups results and previews the highlighted one.
- [ ] M8-18c. Typing `?` first switches to meaning search; it never triggers by itself.
- [ ] M8-18d. Reject on a hunk restores the text from before the agent.
- [ ] M8-18e. Blame on an agent line names the agent, the run and the age.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
