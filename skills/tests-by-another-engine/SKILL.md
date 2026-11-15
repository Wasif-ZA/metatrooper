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
exposes a real bug stays failing, marked as a strict expected failure (pytest
`xfail(strict=True, reason=...)` or the framework's equivalent) with a one-line reason; do not fix
code.
Run: <exact test command>. Never commit or push.
Final answer: files changed, pass, fail and expected-fail counts copied from the run, bugs found.
```

## 2. Launch on another engine

The implementation is usually uncommitted, and a new worktree would not contain it. So run the
test engine in the same checkout, without `--worktree`.

1. Save the before state: `git status --porcelain > .troop/tests-brief/before.txt`.
2. `troop launch <engine that is not you> --project . --prompt "Read <abs path>/brief.md and do it." --json`
3. `troop wait <id> --json`. It also returns on timeout (exit 4), when the session goes idle, or
   when it waits on a person. Check the returned state: only `done` means finished. Otherwise
   `troop read <id> --json` and decide; a session waiting on a person goes to the user.

## 3. Check what came back

- `git status --porcelain` again and compare with `before.txt`. Every new or changed path must be
  a test file, staged or not, tracked or not. Anything else: reject and rerun.
- Run the command yourself; the counts must match its report.
- Every strict expected failure is an open bug in the code. The suite is not green while any
  remain; report them as bugs, never as passes.
- Give the user the bug list with the failing test for each. Fix only the ones they pick, then
  remove that marker. Never edit a test to make it pass.

## 4. Prove the tests bite

Pick 3 to 8 mutants on the lines the spec cares about most: `<` to `<=`, a removed guard, a
dropped field, a flipped refusal. For each: apply it, run the narrowest test command, record
caught or survived, revert. A surviving mutant means a missing test: add it (through the other
engine again) and rerun. Report the caught count, for example "7 of 8 mutants caught".
