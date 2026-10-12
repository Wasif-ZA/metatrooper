# M7-10: Session launcher in Rust, so a closed session takes every process it started with it

Part of the MetaTrooper desk epic, Milestone 7. Priority: High. Effort: 2.0 CC days (build; milestone review share in spec.md). Depends on: none.
Decision: D82.

## Source of truth

- `spec.md`: the Milestone 7 children table row M7-10, D82, and the M7-10 section.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Context

Measured 2026-10-12T19:00+11:00 on this laptop, 19.6 GB of 31.4 GB in use with 6 Claude sessions open:

| What | Processes | Memory |
|---|---|---|
| Codex processes left behind by closed sessions (plugin brokers, `codex.exe` app servers, tool hosts) | about 230 | about 8.3 GB |
| Claude Code, 6 sessions | 6 | 2.9 GB |
| Workbench (Electron) | 21 | 1.9 GB |
| Pinterest MCP, two per Claude session | 24 | 1.1 GB |
| `launch.js`, one Node process per session | 6 | 0.37 GB |
| Core | 1 | 0.16 GB |

The Codex plugin starts its broker with `spawn(..., { detached: true })` and `unref()`
(`~/.claude/plugins/cache/openai-codex/codex/1.0.5/scripts/lib/broker-lifecycle.mjs:61-67`). When the Claude session
ends, the broker and its `codex.exe` stay. 20 brokers had outlived their session; Claude Code stopped two review
queues for low memory that day.

`core/launch.js` is a Node process per session whose only job is `core/src/hook/launch.ts` (57 lines): decode the
argv, set `TROOP_SESSION_ID`, write the `launch` event, resolve the command, spawn it, pass the exit code back. It
costs about 60 MB per session.

## Current state (verified 2026-10-12 at a2b9764)

| Piece | Where | State |
|---|---|---|
| Launcher path | `core/src/sessions/launch.ts:98` | `path.join(coreDir, 'launch.js')` |
| Pty start | `core/src/sessions/launch.ts:106` | `term.open(id, [process.execPath, '--no-warnings', launcher, '--session', id, '--engine', engine, '--args-b64', b64], cwd, env)` |
| Pty pid | `core/src/terminal/index.ts:61, 98` | `open()` returns `proc.pid` |
| Launch logic | `core/src/hook/launch.ts` | argv decode, `TROOP_SESSION_ID`, `recordLaunch`, `resolveCommand`, spawn, exit code |
| Command lookup | `core/src/hook/resolve.ts` | 41 lines: PATH and PATHEXT, `.cmd` shims |
| `launch` event use | `core/src/events/processor.ts:80` | sets `session.pid` from `payload.pid` |
| Kill on close | nowhere | a process the engine starts detached outlives the session |

## Proposed change

A new Rust binary, `metatrooper-launch.exe`, takes the place of the `launch.js` Node process on Windows.

```
before:  ConPTY -> node launch.js (60 MB) -> claude.exe -> node broker (detached, survives)
after:   ConPTY -> metatrooper-launch.exe (job, kill on close, ~2 MB) -> claude.exe -> broker (in the job, dies)
```

### Implementation details

1. **Spike first (0.25).** On this laptop, a 30-line Rust program creates a job with
   `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` and without the breakaway flags, assigns itself, and starts a Claude
   session that runs one `/codex:review`. Record in this issue: after the program exits, is the broker and its
   `codex.exe` gone within 2 s? Does the session still work under ConPTY with the job nested? If the broker survives,
   stop and report; the folder sweep in "Fallback considered" replaces this child.
2. **Crate.** New `launcher/` at the repo root: `Cargo.toml`, `src/main.rs`. No crates: the six kernel32 calls
   (`CreateJobObjectW`, `SetInformationJobObject`, `AssignProcessToJobObject`, `GetCurrentProcess`,
   `SetConsoleCtrlHandler`, `CloseHandle`) are declared by hand with `extern "system"`. `windows-sys` fails the
   25k-star dependency gate. Release profile: `opt-level = "z"`, `lto = true`, `panic = "abort"`, `strip = true`.
3. **Behaviour.** Same flags as today (`--session`, `--engine`, `--args-b64`). It creates the job and assigns itself
   before it starts anything, so every descendant inherits the job. It sets `TROOP_SESSION_ID`, resolves the command
   the way `resolve.ts` does (PATH, PATHEXT, `.cmd` through `cmd.exe /d /s /c`), starts it with inherited stdio,
   ignores Ctrl+C and Ctrl+Break itself, and exits with the child's code. Error texts and codes stay: "troop launch:
   no command given" exit 2, "troop launch: could not find X on PATH" exit 127, "troop launch: could not start X"
   exit 127. When it exits, the job handle closes and Windows ends every process left in it.
4. **Launch event moves to the core.** `core/src/sessions/launch.ts` writes the `launch` event itself right after
   `term.open`, with `pid` set to the value `open()` returns and the same payload shape. `launch.ts` in `hook/` stops
   writing it, so the Node fallback and the Rust launcher behave the same and the Rust side needs no SQLite.
5. **Choice of launcher.** `launch.ts:98` uses `<coreDir>/bin/metatrooper-launch.exe` when it exists on Windows,
   else `node launch.js` as today, and writes one log line naming which. Linux keeps `launch.js` (the source beta,
   M5-D4).
6. **Build and ship.** `.github/workflows/ci.yml` gains a Windows job: `cargo build --release` in `launcher/`, then
   the launcher tests. `tests/release.ps1` builds it. The M5-1 installer copies the binary into `core/bin/`. The M5-2
   signing step signs it along with the rest. A dev checkout without Rust still works through the fallback.
7. **Docs.** `CONTRIBUTING.md` names the Rust toolchain as optional; `README.md` Known limits says a session's
   descendants are ended on close on Windows only.

### Fallback considered

On pty exit the core lists processes whose command line carries `--cwd <session folder>` and ends them with
`taskkill /T`. About 0.5 CC days, no new binary. Rejected as the main fix (D82): it misses a process started from
another folder and saves no memory per session. It stays the plan if the spike fails.

## Acceptance criteria

- [ ] M7-10a. A fixture engine that starts a detached, unref'd grandchild and then waits: after its session's
  terminal is closed, the grandchild's pid is gone within 2 s.
- [ ] M7-10b. The launcher's working set is at most 5 MB with a session running, read from the process table.
- [ ] M7-10c. Parity with `launch.js`: the child sees `TROOP_SESSION_ID`; exit code 7 comes back as 7; an empty
  argv exits 2 and an unknown command exits 127 with today's texts; a `.cmd` engine starts; Ctrl+C typed in the tile
  reaches the engine and the launcher keeps running; one `launch` event per session carries the pty pid.
- [ ] M7-10d. With `core/bin/metatrooper-launch.exe` removed, a session starts through `launch.js` and the core log
  names the fallback.
- [ ] M7-10e. The spike's result (broker gone or not, ConPTY nesting fine or not) is recorded in this issue.

## Sizing

Spike 0.25 + crate and behaviour 0.5 + `resolve.ts` port 0.25 + launch event move and launcher choice 0.25 + CI,
release script and installer 0.5 + tests 0.25 = 2.0 CC days.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests (D65), with a mutation run that must fail at least one test.
- No em dashes; comments say what the code does, not why.
