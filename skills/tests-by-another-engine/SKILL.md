---
name: tests-by-another-engine
description: When one engine wrote the code, have a different engine write the tests from the spec so the tests cannot share the code's blind spots, then prove the tests catch bugs with a small mutation run. Use for "let another model write the tests", "do the tests actually catch anything", "the AI wrote both", or before merging AI-written code that someone will review.
---

# tests-by-another-engine

The engine that wrote the code writes tests that pass its own mistakes. A different engine,
working from the spec, does not.

## 1. Write the brief

`.troop/tests-brief/brief.md`. Fill every placeholder from the repo:

```text
Tests only, in <repo>. Do not edit anything under <code dirs>.
Another engine wrote the implementation; test it against <spec path and sections>.
Read <the diff or named files> and the spec first.
What changed: <each behaviour as input -> observable result>
Tasks: A. update existing tests that pin the old contract: <list>.
       B. new tests in <file> covering: <edge cases, one per line>.
Rules: synthetic fixtures built in a temp dir; no network or real data. Expected values are
literals worked out from the spec, never computed by calling the code under test. A test that
exposes a real bug stays failing, marked expected-fail with a one-line reason; do not fix code.
Run: <exact test command>. Never commit or push.
Final answer: files changed, pass and fail counts copied from the run, bugs found.
```

## 2. Launch on another engine

`troop launch <engine that is not you> --project . --worktree tests-brief --prompt "Read <abs path>/brief.md and do it." --json`,
then `troop wait <id> --json`.

## 3. Check what came back

- `git diff --stat` in its worktree: only test files changed, or reject and rerun.
- Run the command yourself; the counts must match its report.
- Each expected-fail is a bug report about the code. Fix the code, then remove the marker.
  Never edit a test to make it pass.

## 4. Prove the tests bite

Pick 3 to 8 mutants on the lines the spec cares about most: `<` to `<=`, a removed guard, a
dropped field, a flipped refusal. For each: apply it, run the narrowest test command, record
caught or survived, revert. A surviving mutant means a missing test: add it (through the other
engine again) and rerun. Report the caught count, for example "7 of 8 mutants caught".
