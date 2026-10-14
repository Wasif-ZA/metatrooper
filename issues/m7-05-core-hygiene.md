# M7-5: Core hygiene: token masking, WAL result, port bind test, regex caps, hook repair, sandbox containers

Part of the MetaTrooper desk epic, Milestone 7 (after the release). Priority: High. Effort: 2.0 CC days. Depends on: M6-3, M6-4 (both merged), and M6-23 for the `state_titles` and idle title rules it adds. Start from `main` after the public release on 2027-01-19; record that `main` SHA as the base in the report.

## Source of truth

- `spec.md`: the Milestone 7 children table row M7-5, and the `### M7-5:` section under Milestone 7. D73 and D77 say why it is in this milestone.
- `ide-layer-research/idea-coverage.md` names the mined ideas this child builds: core-services 10, 11, 12, 13 and core-sessions 12, 13.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Context

Six small fixes in the core, each closing a way it says something false or keeps something broken: a token printed by an agent reaches the logs and the wall; a busy WAL checkpoint fails with no trace; a port that is bound but not yet listening is handed out; a regex from an engine file or a plugin can hang the watcher; a global hook install from an old path fails on every Claude event forever; a sandbox container left by a crash runs on with no owner. Nothing here adds UI.

## Current state (verified 2026-10-14 on `main` 4fb7ef9; find code by the quoted text, line numbers move)

| # | Fact | Where |
|---|---|---|
| 1 | `CREDENTIAL_PATTERNS` holds 8 regexes (GitHub `gh[pousr]_` and `github_pat_`, `sk-`, `AKIA`, `xox`, `AIza`, JWT, private-key header). `looksLikeCredential` and `redactCredentials` add `LONG_RUN`: any 32+ character run mixing digits, lower and upper case. Only approvals call them. | `core/src/redact.ts`; `core/src/approvals.ts` |
| 2 | `appendLog` masks only known secret values (`redactSecretValues`). The live title and last line are stored as the terminal reports them. `notifyText` replaces every 24+ character token run with `<redacted>`, which also hits SHAs and paths. | `core/src/log.ts` `appendLog`; `core/src/terminal/events.ts` `put(id, 'title' ...)`, `readLine`; `redact.ts` `notifyText` |
| 3 | The WAL is checkpointed with `db.exec('PRAGMA wal_checkpoint(TRUNCATE)')` at start, every 30 s and at stop. `exec` drops the result row, so a busy checkpoint is invisible. | `core/src/main.ts`: `every(30_000, ...)`, the start block after `markGone`, `stop` |
| 4 | Ports are free when nothing answers a `net.connect` within 200 ms on 127.0.0.1 or ::1. A socket that is bound but not listening refuses the connect, so its port is leased. One allocation runs at a time (`queue`). | `core/src/ports.ts` `listening`, `leasePort` |
| 5 | Regexes from config are compiled with `new RegExp` with no cap: `auth_ok.stdout_regex` (`engines/health.ts`), `activity_waiting.last_line_regex` (`sessions/watch.ts` `isBlocked`, tested against the whole last line), `auth_error` (`sessions/resume-all.ts` `authFailed`, already cut to the last 4,096 characters). `state_titles` and the idle title rule do not exist yet; M6-23 adds them. The manifest schema caps `auth_error` at 200 characters and nothing else. | as named; `contracts/plugin-manifest.schema.json` |
| 6 | `isOurs` matches a hook only when its command contains the current `eventScript()` path, so entries from an older install path are never seen again. `installClaude` writes `settings.json` with plain `fs.writeFileSync`, not the tmp, fsync and rename that `setSetting` uses. The install record `state.claude` holds `{file, original, installed, absentEvents}`: no script path and no version. | `core/src/hooks/install.ts`; `core/src/settings.ts` `setSetting` |
| 7 | `dockerArgv` runs `--rm --name troop-<last 8 of id>` with no `--init` and no labels. A session's container is removed with `rm -f` when the session ends; one left by a crashed core is never removed. | `core/src/sandbox/launch.ts` |
| 8 | There is no sandbox setting. The sandbox is chosen per launch (`host: 'sandbox'` with `isolated`), and `session.host` records it. `containerRuntime()` runs `docker version` synchronously with a 15 s timeout. | `core/src/methods.ts` `session.launch`; `contracts/schema.sql` `session.host`; `core/src/sandbox/checks.ts` |

## Change

1. **Token masking.**
   - `CREDENTIAL_PATTERNS` becomes `TOKEN_RULES` in `redact.ts`: about 20 rules `{id, keywords, re, min_entropy}` covering the 8 above plus Anthropic `sk-ant-`, OpenAI `sk-proj-`, Stripe `sk_live_` and `rk_live_`, GitLab `glpat-`, npm `npm_`, PyPI `pypi-`, Hugging Face `hf_`, Google OAuth `ya29.`, Azure storage `AccountKey=`, SendGrid `SG.`, and `Bearer` followed by a token. Rules live in code, not a JSON file.
   - `maskTokens(text)` runs a rule's regex only when the text contains one of its keywords (case-sensitive `includes`), and replaces a match with `[token]` when the match's Shannon entropy is at least `min_entropy` bits per character. It does not use `LONG_RUN`, so SHAs, UUIDs and base64 paths survive.
   - `looksLikeCredential` and `redactCredentials` read their regexes from `TOKEN_RULES` and keep `LONG_RUN`; approvals keep their current wider net.
   - Called in `appendLog` after `redactSecretValues`, on the title and last line in `terminal/events.ts` before `put`, and first in `notifyText`. The tile body is the raw pty stream and is not masked (Known limits).
2. **WAL result read.** The three checkpoints go through one `checkpoint(db)` that reads the row from `db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()`. When `busy` is 1 it adds one to the `meta` row `wal_truncate_misses` and, for the 30 s tick only, runs once more 5 s later (that retry counts a miss too and schedules nothing). `core.ping` adds `wal_truncate_misses` (a number, 0 when the row is absent) and `troop ping` prints it. `contracts/pipe-protocol.md` and the `meta` rows comment in `contracts/schema.sql` name the field.
3. **Ports by bind test.** A port is taken when it has a lease row, or `net.createServer().listen({port, host, exclusive: true})` fails on 127.0.0.1 or ::1 with `EADDRINUSE` or `EACCES`, or the existing connect probe answers. `EADDRNOTAVAIL` on ::1 (IPv6 off) is skipped. Each test server is closed before the next port is tried. The connect probe stays, because on Windows a bind to 127.0.0.1 can succeed while another program listens on 0.0.0.0 with address sharing.
4. **Regex caps.** New `core/src/sessions/compile-rule.ts` exports `compileRule(source, flags)`. It throws on a source over 200 characters, or one where a quantified group holds a quantifier (`(a+)+`, `(a*)*`, `(a+){2,}`, `(\w|\d+)*`), found by a scan of the source, not by running it. `testRule(re, text)` tests only the last 4,096 characters. Every regex from config goes through both: `auth_ok.stdout_regex`, `activity_waiting.last_line_regex`, `auth_error`, and M6-23's `state_titles` and idle title rule. An engine file with a refused rule loads with that rule off and one log line naming the engine and field. `validateManifest` refuses a plugin whose engine carries a refused rule, naming the field.
5. **Hook repair.**
   - `setSetting`'s tmp, fsync and rename move into `writeAtomic(file, text)` in `core/src/atomic.ts`; `setSetting`, `installClaude` and `writeState` use it.
   - `installClaude` records `script: eventScript()` and `version` (the root `package.json` version) in `state.claude`.
   - At core start, when `state.claude` exists: skip if its `version` is newer than this core's; skip if its `script` exists on disk and differs from `eventScript()` (another install or a dev checkout). Otherwise find every hook command shaped `node "<path>event.js" claude.<Event>`; if any names a missing file, or names a file other than `eventScript()` while `script` equals it, copy `settings.json` to `settings.json.troop.bak` (only when no `.bak` exists), drop those entries, and run `installClaude`. A record with no `script` (installs before this change) only drops entries naming a missing file. Nothing else in `settings.json` changes.
6. **Sandbox containers.**
   - `dockerArgv` adds `--init`, `--label troop=1` and `--label troop.session=<id>`.
   - At core start, after the pipe is serving and never blocking it: when `session` holds at least one row with `host = 'sandbox'`, the core runs `<runtime> ps -a --filter label=troop=1 --format '{{.Label "troop.session"}} {{.ID}}'` asynchronously and removes (`rm -f`) each container whose session is not live. When no such row exists, the core never calls `docker` or `podman`.

## Acceptance criteria

The first six are copied from `spec.md` and must not be reworded here.

- [ ] M7-05a. A corpus of 20 real-shaped tokens and 200 harmless lines (git SHAs, UUIDs, base64 paths) masks 20 of 20 and at most 2 of 200, at under 50 microseconds per 200-character line.
- [ ] M7-05b. A reader opens a read transaction, then the core writes 100 rows and runs one checkpoint: one miss is counted and `troop ping` shows 1. After the reader ends, the `-wal` file is 0 bytes within 35 s.
- [ ] M7-05c. With 3001 bound but not listening and 3002 listening, allocation returns 3003; a stubbed `EACCES` on 3003 gives 3004; 20 leases at once give 20 different ports.
- [ ] M7-05d. A manifest with `(a+)+$` is refused at install, and the same pattern in an engine file's `state_titles`, `auth_error` and `auth_ok.stdout_regex` is refused at load. A valid rule on a 1 MB line returns in under 5 ms.
- [ ] M7-05e. A `settings.json` whose MetaTrooper hook names a missing `event.js` is rewritten once with a `.bak`; a second core start changes 0 bytes; the user's other hooks parse to the same JSON. A dev checkout and an install recorded by a newer version are each left unchanged.
- [ ] M7-05f. With the core stopped, a labelled fixture container whose session exited is removed at the next core start; a container for a live session is left running; a sandbox session's `docker inspect` shows `Init: true`. With the sandbox flag off, the core starts without calling `docker`. ("Sandbox flag off" here means no `session` row has `host = 'sandbox'`; see the report.)
- [ ] M7-05g. A token printed in a terminal shows as `[token]` in the session's stored title and last line, in the core log and in a notification sink message; the same token is still in the raw pty stream.
- [ ] M7-05h. Approvals still ask on every string that asked before: the M6-2 approval suite passes unchanged.
- [ ] M7-05i. `writeAtomic`: a crash between write and rename (stubbed `renameSync` throwing) leaves the old `settings.json` byte for byte.
- [ ] M7-05j. With no sandbox row, the core reaches `core.ping` without spawning a process named `docker` or `podman` (spawn spy). With one, `core.ping` answers before `docker ps` returns (a fake runtime that sleeps 10 s).
- [ ] M7-05k. An engine file with a refused `last_line_regex` loads, its watcher rule is off, and the core log names the engine and the field once.
- [ ] M7-05l. Each test states its card: `protects=`, `fails_when=`, `no_claim=`.
- [ ] M7-05m. The existing core and workbench suites still pass.

## Testing plan

Codex writes every test below through `/tests-brief` (D65), with a mutation run that must fail at least one test per part: drop the keyword gate, ignore `busy`, remove the bind test, skip `compileRule` in `watch.ts`, write the hooks without the version check, and leave `--init` out.

| Layer | What | Count |
|---|---|---|
| Unit | a (corpus, timing), d (compile and test), i (atomic write), k | +4 |
| Core with a temp home | b (reader holds a transaction), c (bound socket, stubbed `EACCES`, 20 at once), e (fixture `settings.json`, dev checkout, newer version), g, h, j | +6 |
| Docker, skipped with "no container runtime" when `containerRuntime()` is null | f | +1 |

## Rules for the implementing agent

1. Acceptance criteria are the `protects / fails_when / no_claim` profile of each test: never "make the tests pass".
2. Real code lands with Codex's tests in the same change; you do not write the tests (D65).
3. Any change to an existing test, timeout or threshold is reported on its own line first, with its reason.
4. A reported command names the command and its observed result; stderr is never silenced in a cited command.
5. Your report is a claim until the parent re-runs it.
6. Never commit, push or open PRs; hand back the command. No em dashes; comments say what the code does.
7. Nothing here starts before the public release on 2027-01-19.

## Rollback

Revert the merge. The `meta` row `wal_truncate_misses`, the container labels and the `script` and `version` fields in the hooks state are additive and ignored by older code. A repaired `settings.json` has its `.bak` beside it.

## Effort

0.6 token rules, `maskTokens` and its three call sites, 0.2 checkpoint result and `core.ping` field, 0.2 bind test, 0.2 `compileRule` and its five call sites, 0.3 `writeAtomic` and hook repair, 0.2 container labels, `--init` and the start sweep, 0.3 tests brief and mutation run = 2.0 CC days.

## Files

| File | Change |
|---|---|
| `core/src/redact.ts` | `TOKEN_RULES`, `maskTokens`, `notifyText` calls it |
| `core/src/log.ts` | `appendLog` calls `maskTokens` |
| `core/src/terminal/events.ts` | title and last line masked before `put` |
| `core/src/main.ts` | `checkpoint(db)` at start, every 30 s and at stop; the container sweep after the pipe serves; hook repair at start |
| `core/src/methods.ts`, `core/cli.ts` | `wal_truncate_misses` in `core.ping` and `troop ping` |
| `core/src/ports.ts` | bind test beside the connect probe |
| `core/src/sessions/compile-rule.ts` | new |
| `core/src/engines/health.ts`, `core/src/sessions/watch.ts`, `core/src/sessions/resume-all.ts`, `core/src/plugins/manifest.ts` | go through `compileRule` and `testRule` |
| `core/src/atomic.ts` | new: `writeAtomic` |
| `core/src/settings.ts`, `core/src/hooks/install.ts` | use `writeAtomic`; `script` and `version` in `state.claude`; `repairClaudeHooks()` |
| `core/src/sandbox/launch.ts` | `--init`, labels, `sweepContainers()` |
| `contracts/pipe-protocol.md`, `contracts/schema.sql` | `wal_truncate_misses` |
| `core/test/` | Codex's tests above |

## Out of scope

- Masking the tile body (the raw pty stream).
- Checkpointing by WAL size before the 30 s tick (the idea's first half; the 30 s promise in `pipe-protocol.md` stays as it is).
- Repairing Codex, Gemini or other engines' hook files; only Claude's global install is repaired.
- A user-facing sandbox switch.
