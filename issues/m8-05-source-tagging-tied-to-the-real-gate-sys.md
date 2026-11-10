# M8-5: Source tagging tied to the real gate system

Part of Ouros, Milestone 8. Build step G5. Priority: Critical. Effort: not sized (sized after M8-0). Depends on: M8-2, M8-21.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 3, 7; `spec.md` Milestone 8 children table row M8-5.
- Source: `ouros-spec.md` (copied 2026-10-31 from scratch `ouros-ide-fiveshot-2026-10-30/kit/SPEC.md`).

## Context

Only Ouros draws the needs-you colour or a real gate. An agent-drawn gate is a grey "<agent> asks you, not a gate" card. A real gate is answered with a single-use token for one exact action and hash.

No screen: a decision card in Needs you, with toggles in Settings > Reliability > Asking.

## Blocked on

- NEWFEATURES.html keep/change/drop on f-intent.

## Acceptance criteria

- [ ] M8-05a. An agent-drawn gate cannot resolve a real gate (test).
- [ ] M8-05b. An event named "approve" from an agent surface reaches that agent as plain text only.
- [ ] M8-05c. On agent surfaces the asker's name is the real agent, never the `from` it sends (spoofed-name test).
- [ ] M8-05d. Clarify inside the plan gate: only when the ambiguity changes what gets done, the plan gate offers two readings and lists the files it plans to touch; an edit outside that list is flagged.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Agents draw only from the catalogue: no agent HTML, iframe or script (ouros-spec.md section 7).
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
