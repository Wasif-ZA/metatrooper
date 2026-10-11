# M7-5: Core hygiene: token masking, WAL result, port bind test, regex caps, hook repair, sandbox containers

Part of the MetaTrooper desk epic, Milestone 7 (after the release). Priority: High. Effort: 2.0 CC days. Depends on: M6-3, M6-4.

## Source of truth

- `spec.md`: the Milestone 7 children table row M7-5, and the `### M7-5:` section under Milestone 7. D73 and D77 say why it is in this milestone.
- `ide-layer-research/idea-coverage.md` names the mined ideas this child builds.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M7-05a. A corpus of 20 real-shaped tokens and 200 harmless lines (git SHAs, UUIDs, base64 paths) masks 20 of 20 and at most 2 of 200, at under 50 microseconds per 200-character line.
- [ ] M7-05b. A reader opens a read transaction, then the core writes 100 rows and runs one checkpoint: one miss is counted and `troop ping` shows 1. After the reader ends, the `-wal` file is 0 bytes within 35 s.
- [ ] M7-05c. With 3001 bound but not listening and 3002 listening, allocation returns 3003; a stubbed `EACCES` on 3003 gives 3004; 20 leases at once give 20 different ports.
- [ ] M7-05d. A manifest with `(a+)+$` is refused at install, and the same pattern in an engine file's `state_titles`, `auth_error` and `auth_ok.stdout_regex` is refused at load. A valid rule on a 1 MB line returns in under 5 ms.
- [ ] M7-05e. A `settings.json` whose MetaTrooper hook names a missing `event.js` is rewritten once with a `.bak`; a second core start changes 0 bytes; the user's other hooks parse to the same JSON. A dev checkout and an install recorded by a newer version are each left unchanged.
- [ ] M7-05f. With the core stopped, a labelled fixture container whose session exited is removed at the next core start; a container for a live session is left running; a sandbox session's `docker inspect` shows `Init: true`. With the sandbox flag off, the core starts without calling `docker`.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for this child (D65), with a mutation run that must fail at least one test.
- Nothing here starts before the public release on 2027-01-19.
- No em dashes; comments say what the code does, not why.
