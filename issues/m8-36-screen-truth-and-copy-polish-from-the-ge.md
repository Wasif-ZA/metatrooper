# M8-36: Screen truth and copy polish from the Gemini review

Part of Ouros, Milestone 8. Priority: Medium. Effort: not sized (sized after M8-0). Depends on: M8-1, M8-5.
Status in scratch: review findings; check which are already fixed.

## Source of truth

- `spec.md` Milestone 8 row M8-36; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): ~/.cache/claude-scratch/ouros-agy-2026-10-30/trust-polish-answer.md (trust.png, p-seo-audit-fix, p-data-to-dashboard, p-form-fill-batch, any-revise).

## What was designed

- Four screens say "0 need you" in the status bar while the canvas is stopped on a needs-you.
- ASCII pipe bars sit next to real bars on three screens; an approval card's top border is dashes.
- any-revise uses orange for failed quizzes and missed days, breaking orange = needs you.
- A batch selector highlights row 1 while the headline says row 3. Dev words leak into copy ("shot", "QA", "readback round 2", raw deploy commands).
- The forged-gate card on the trust screen shows an Approve button, against ouros-spec.md section 7.

## Acceptance criteria

- [ ] M8-36a. The need-you count comes from the same state as the canvas.
- [ ] M8-36b. One progress part everywhere; no pipe-character bars.
- [x] M8-36c. `workbench/test/m8-01-kit-parts.test.ts` fails any agent-drawn part that draws the needs-you colour. (was: check.mjs fails any orange that is not needs-you)
  Status: DONE for agent-drawn parts. Ouros's own screens are not covered by this test.
  Verify: `cd workbench; node --test --test-isolation=none --test-timeout=120000 --test-name-pattern="never draw the needs-you colour|reserved colour stays absent" test/m8-01-kit-parts.test.ts` (52 tests, pass).
- [ ] M8-36d. The forged-gate card has no button.
- [ ] M8-36e. A word list check finds no dev words in screen copy.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
