# M6-17 report: public API, one method list, `session.wait`

Branch `m6-17-public-api`. The main work is in 4f38085 (one declared method list, generated table, help and skill,
`session.list` and `session.wait`). This pass checked it against the criteria and added one test assertion.

## Criteria

### M6-17a: MET

The generated method table, `troop --help` and the skill list the same methods as `methods.ts`; a test fails when one is edited by hand.

- `core/src/methods.ts` `METHODS` declares each method once with params, result, errors, `stable` and `needsUi`.
  `buildMethods` takes `needsUi` from the declaration, so the flag is no longer set in two places.
- `core/gen-methods.ts` writes `METHODS` into `contracts/pipe-protocol.md` and `skills/troop/SKILL.md`, between
  the `<!-- methods:start/end -->` markers. A fresh `node core/gen-methods.ts` changed nothing, so both files are current.
- `troop --help` (and `troop help`) builds its method list from `methodHelp()` each time it runs.
- `core/test/m6-17-public-api.test.ts`:
  - `each GENERATED entry matches file on disk...` checks that each block on disk equals the generated text.
    A mutation check (one SKILL.md row edited by hand) made this test fail with exit 1. The edit was reverted.
  - `troop --help stdout lists every METHODS name` runs the real CLI.
  - `buildMethods key set equals METHODS names...` checks three things: `METHODS` against the literal spec list
    (the assertion added in this pass), the registered handlers against `METHODS` plus the moved methods, `needsUi`
    for each method, and -32601 "moved to the pipeline products" for each moved method.

### M6-17b: MET

`session.wait` returns within 1 s of the state change, at once when already in the state, at the timeout when it never comes, and -32602 for an empty `states` or a `timeout_ms` of 0.

Each item below is tested over the real pipe against an isolated core harness:

- State changes about 500 ms after the call: it returns `{state: "working", timed_out: false}` with elapsed minus
  500 ms under 1000 ms.
- Already in the state: it returns in under 300 ms.
- State never comes (`timeout_ms: 400`): it returns `{state: "idle", timed_out: true}` after at least 400 ms and
  before 1400 ms.
- -32602 for `states: []`, an unknown state name, `timeout_ms: 0` and `timeout_ms: 600001`. An unknown session
  returns -32002.
- Called through `core/src/pipe/client.ts` with `waitMs` larger than `timeout_ms`, it gets a reply. It is never
  queued, because `session.wait` and `session.list` are in `NOT_QUEUED`.

## Tests

- `cd core && node --test test/m6-17-public-api.test.ts`: 10 tests, 10 pass, 0 fail.
- `cd core && npm test` (full core suite): 295 tests, 291 pass, 0 fail, 4 skipped.
- The worktree had no `node_modules`, so I ran `npm ci` in `core/` first. npm warned that node-pty's install script
  is not in `allowScripts`. The tests passed anyway.

## Left for Wasif

1. **spec.md and the contract disagree on `session.wait`.** spec.md (Public API section) says an unknown session
   is **-32004** and the result is `{state, reason?, timed_out}`. `contracts/pipe-protocol.md` and the code use
   **-32002** and `{state, timed_out}`. I followed the contract, as the issue says the contract wins. Also, -32004
   is not defined anywhere in the repo: `errors.ts` and the contract's error table map "not found (session)" to
   -32002. One caveat: this branch generated the contract row from `METHODS`, so the contract is not a separate
   check here. If `reason` is wanted, say what it holds. Otherwise fix spec.md to match.
2. **`session.wait` checks the database every 200 ms** (marked with a `ponytail:` comment). So a reply lands up
   to about 200 ms after the change, well inside 1 s. Switch to a state-change event if many waiters pile up.
3. **The rules conflict about committing.** The issue file says "never commit from an agent", but this task asked
   for commits on the branch. I committed as asked, with plain messages and no trailers. Nothing is pushed or merged.
4. **D65 does not list M6-17**, so the rule that Codex writes the tests did not apply. The tests here came from the
   earlier commit, plus one assertion added in this pass.
