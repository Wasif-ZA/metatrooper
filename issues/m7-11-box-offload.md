# M7-11: Easy work runs on the Linux box, so the laptop stops carrying jobs an idle machine could take

Part of the MetaTrooper desk epic, Milestone 7. Priority: Medium. Effort: 2.75 CC days (build; milestone review share
in spec.md). Depends on: none. Part A ships first; part B reuses A's box check.

## Context

`agent-laptop` sits on Tailscale SSH, always on, mostly idle. Over 14 days, 147 MetaTrooper transcripts ran 604 test
suites (`node --test`), 69 Electron or Playwright QA runs and 21 side-task launches, all on this laptop. Both repos are
in scope: the vault (`~/teehee`) and `projects/metatrooper`. ACU work never leaves this laptop.

Decisions taken in the /spec interview, 2026-10-12:

| # | Question | Decision |
|---|---|---|
| D1 | What is easy work | Test runs first (part A), then side-task agents (part B) |
| D2 | How code reaches the box | Tar over SSH, as `meta/commands/deploy-to-box.sh` does |
| D3 | How a job is picked automatically | By job kind; falls back to local when the box is down or short of memory |
| D4 | How agent changes come back | Patch applied to a local `box/<session>` worktree branch; nothing goes via GitHub |

## Current state (verified 2026-10-12T20:10+11:00)

| Piece | Where | State |
|---|---|---|
| Box reach | `ssh -o BatchMode=yes agent-laptop` | Works. 8 cores, 7 GB RAM, about 2 GB `MemAvailable` with its 4 tmux sessions up |
| Box Node | `~/.nvm/versions/node/v24.15.0`; `/usr/bin/node` v22.22.1 | `core/package.json:8` wants `>=24.16`. nvm is not on the non-interactive SSH PATH |
| Box engines | `~/.nvm/versions/node/*/bin/{claude,codex}` | Installed and logged in (the `planner` session runs in auto mode) |
| Box clones | `~/projects/metatrooper` at 6ba947d (M1-06); `~/vault` | Owned by box crons. This spec never writes to them |
| Command runner | `router/metarouter/cli.py:237` `exec_lane` | Always runs locally via `run_shell` (`:98`) |
| Session hosts | `core/src/sessions/launch.ts:68` | `host: 'pty' \| 'sandbox'`; sandbox events come through a spool file (`core/src/sandbox/spool.ts`) |
| Approval profiles | `core/src/engines/registry.ts:61, 71` | claude and codex both have `contained` (claude `--permission-mode auto`, codex `--approve-for-me`) |

## Proposed change

### Shared: the box check

`router/metarouter/box.py` (part A) and `core/src/box.ts` (part B) each run the same probe:

```
ssh -o BatchMode=yes -o ConnectTimeout=5 agent-laptop "awk '/MemAvailable/{print \$2}' /proc/meminfo; source ~/.nvm/nvm.sh >/dev/null && node -v"
```

The box is usable when the probe exits 0, memory is at or above the floor, and the Node major.minor meets
`core/package.json` `engines.node`. The result is cached for 60 s in `~/.metarouter/box.json` and the core keeps its
own copy in memory. Floors: tests 1024 MB, agents 1536 MB. Worked example at today's numbers: 2 GB free is 2048 MB, so
2048 >= 1024 lets a test run go, and 2048 >= 1536 lets one agent go. Once that agent's ~500 MB is taken, 2048 - 500 =
1548 MB is left, which is just above 1536, so it lets a second agent through. A third is refused.

Settings, one block in each tool's config (`metarouter` `config()` and core `settings()`):

```json
"box": {
  "host": "agent-laptop",
  "enabled": true,
  "repos": ["C:/Users/User/teehee", "C:/Users/User/teehee/projects/metatrooper"],
  "min_free_mb_test": 1024,
  "min_free_mb_agent": 1536
}
```

A job is eligible only when its git root is exactly one of `repos`. `work/`, `hwbreports*` and `agg-hwbreports*` are
never sent, whatever the repo (the exclude list is hardcoded, not a setting).

### Part A: test runs go to the box (metarouter)

1. **Match.** In `exec_lane`, after `policy.verdict` and before `run_shell`, `box.route(cmd, cwd)` returns a remote
   plan when all of these hold, otherwise `None`:
   - the command matches `^(node --test|npm (run )?test|pytest)\b`;
   - the git root is in `box.repos` and the cwd is not under `work/`;
   - `METAROUTER_BOX` is not `0`, and `--local` was not passed;
   - the box check passes against `min_free_mb_test`.
2. **Sync.** The local tree is mirrored to `~/mt-box/<repo-name>/`, which this spec owns. The file list is
   `git ls-files -co --exclude-standard -z`, minus the hardcoded excludes and `node_modules/`. A local manifest at
   `~/.metarouter/box/<repo-name>.manifest` stores path, size and mtime. Only changed files are tarred to
   `ssh agent-laptop "tar -x -C ~/mt-box/<repo-name>"`. Files deleted since the last sync go to `xargs rm -f` on the
   box. When `package-lock.json` changes hash, run `npm ci` in that folder on the box.
3. **Run.** `ssh agent-laptop "flock -n ~/mt-box/.test.lock bash -c 'source ~/.nvm/nvm.sh && cd ~/mt-box/<repo>/<rel-cwd> && <cmd>'"`.
   The output goes through the existing `finish()`, so shrink and logging behave as now.
4. **Fallback.** If the sync fails, the lock is held (flock exits 1 before running anything), or ssh exits 255, run
   locally with `run_shell` and add the note `box unavailable: <reason>; ran locally`. Any other non-zero exit is the
   test result and is not retried.
5. **Note.** A remote run adds `ran on agent-laptop (linux)`. Tests that skip on `process.platform` then show as
   skips, as they would on any Linux run.

### Part B: side-task agents go to the box (core)

1. **Host.** `launchSession` takes `host: 'pty' | 'sandbox' | 'box'`. `troop launch` gains `--host box`, `--host local`
   and `--easy`.
2. **Auto rule.** When `--host` is absent, the core picks `box` when all of these hold:
   - the engine is `claude` or `codex`;
   - the job has `--easy`, or its prompt starts with `/local-work`, `/tests-brief`, `@extract` or `@pattern-audit`;
   - the project's git root is in `box.repos` and the cwd is not under `work/`;
   - the box check passes against `min_free_mb_agent`.

   Otherwise `pty`, as today. The launch result says which host was picked and why.
3. **Snapshot.** The core creates a local worktree `box/<session-id-8>` from `HEAD`, using the existing worktree code.
   It runs `git archive HEAD -- . ':!work' ':!**/hwbreports*' ':!**/agg-hwbreports*' | ssh agent-laptop "mkdir -p ~/mt-box/runs/<id> && tar -x -C ~/mt-box/runs/<id>"`,
   then `git init -q && git add -A && git commit -qm base` on the box. Uncommitted local edits are not sent, the same
   as a local `--worktree` launch.
4. **Terminal.** `term.open(id, ['ssh', '-tt', '-o', 'BatchMode=yes', host, "cd ~/mt-box/runs/<id> && source ~/.nvm/nvm.sh && TROOP_SESSION_ID=<id> <argv>"], ...)`.
   Here `<argv>` is `planArgs(engine, prompt, 'contained', ...)`, shell-quoted. The tile is the live remote terminal,
   and `deliverPrompts` writes into it as it does now.
5. **Approval.** Box sessions always start `contained`. `isolated` is refused on the box host with
   `isolated is not allowed on the box host`. `folderApproval` still applies: an ask path forces `ask`.
6. **Return.** When the PTY exits, the core runs `ssh agent-laptop "cd ~/mt-box/runs/<id> && git add -A && git diff --cached --binary base"`.
   It applies the patch with `git apply --index` in the local `box/<id>` worktree and commits it with the message
   `box: <session-id-8> <first 60 chars of prompt>`. The base is the same commit, so the patch applies cleanly. An empty
   diff commits nothing and removes the worktree. Then `rm -rf ~/mt-box/runs/<id>` on the box. If the fetch fails, the
   core adds a `needs_you` row `box-return-failed` naming the session and the remote path, and keeps the remote folder.
7. **Status.** A box tile shows a `box` badge. Hook-driven state (thinking, waiting) is not reported for box sessions
   (out of scope). The tile shows running, then exited.

### One-time box setup (part of this change, local to the box)

`source ~/.nvm/nvm.sh && nvm install 24 && nvm alias default 24`, so the box meets `>=24.16`. Then `mkdir ~/mt-box`.

## Acceptance criteria

1. With the box healthy, `metarouter exec -- "node --test core/test/plugins.test.ts"` from `projects/metatrooper`
   runs on the box: the note says `ran on agent-laptop (linux)` and the exit code matches the remote run.
2. With `box.host` pointed at an unreachable name, the same command runs locally within 6 s and the note says
   `box unavailable: ... ran locally`.
3. A file created under `work/` in the vault never appears in `~/mt-box/teehee/`. Checked by listing the box folder
   after a sync.
4. Editing one file and re-running sends exactly 1 file in the tar (shown by `tar -tv` on a dry run or the sync log).
5. Deleting a tracked file locally removes it from `~/mt-box/<repo>/` on the next sync.
6. A remote test exiting 1 returns exit 1 and is not retried locally.
7. `troop launch claude --project <metatrooper> --easy --prompt "list the files in core/src"` starts a tile with the
   `box` badge, and the claude process runs on the box (`pgrep -af TROOP_SESSION_ID=<id>` over ssh).
8. When that session edits a file and exits, a local branch `box/<id8>` exists with exactly that change in one commit.
   `~/mt-box/runs/<id>` is gone from the box.
9. `--approval isolated --host box` is refused with the exact text in part B step 5.
10. With `MemAvailable` below 1536 MB (simulated by setting `min_free_mb_agent` to 999999), an `--easy` launch runs
    locally and the launch result says why.
11. A launch whose cwd is under the vault's `work/` never picks the box, even with `--easy` or `--host box`
    (`--host box` is refused with `work/ never runs on the box`).
12. Each test in the Testing Plan states its card: `protects=<observable it protects>; fails_when=<wrong result it rejects>; no_claim=<what green does not prove; which fixtures or mocks stand in for what, or "none beyond protects">`.
13. The existing core and metarouter suites pass with no new failures.

## Testing plan

| Layer | What | Count |
|---|---|---|
| Unit (python) | `box.route` match table: test regex, repo allowlist, `work/` cwd, `METAROUTER_BOX=0`, `--local` | +5 |
| Unit (python) | manifest diff: changed, unchanged, deleted, excluded path | +4 |
| Unit (ts) | auto host rule: each condition false picks `pty`; all true picks `box` | +5 |
| Unit (ts) | box argv: `contained` profile, `isolated` refusal, `work/` refusal, shell quoting of a prompt with quotes | +4 |
| Integration | probe parse and fallback with ssh replaced by a stub script on PATH (exit 255, low memory, old node) | +3 |
| Integration | patch return: two local temp repos stand in for the box, a diff applies to `box/<id>`, empty diff removes the worktree | +2 |
| Live (manual, skipped in CI) | criteria 1, 3, 7, 8 against the real box | 4 |

## Rules for the implementing agent

1. Acceptance criteria are the `protects / fails_when / no_claim` profile of each test: the observable it protects, the wrong result it rejects, and what green does not prove. Never "make the tests pass".
2. Real code and real tests land in the same change; a placeholder, a stub assertion or a test deferred to a follow-up is not done.
3. Any change to a test, validator, CI step, timeout, tolerance, threshold, snapshot or suppression pragma is reported on its own line in your summary with its justification, before any other result.
4. A reported command names the command and its observed result (exit status, counts, the failing line); a command you did not run is not reported, and stderr is never silenced in a command you cite.
5. Your report is a claim until the parent re-executes it: say what you verified, what you reused, and what you could not check.

## Rollback

Set `box.enabled` to `false` in either config: everything runs locally as today. Reverting the PR removes the
code. On the box, `rm -rf ~/mt-box`. No box cron, tmux session or clone is touched.

## Effort

- Part A: probe and cache 0.25, manifest sync 0.5, exec routing and fallback 0.25, tests 0.25 = 1.25.
- Part B: box host and ssh terminal 0.5, snapshot and patch return 0.5, auto rule 0.25, tests 0.25 = 1.5.
- Total: 1.25 + 1.5 = 2.75 CC days.

## Files

| File | Change |
|---|---|
| `router/metarouter/box.py` | New: probe, cache, `route`, manifest sync, remote run |
| `router/metarouter/cli.py:256-263` | Call `box.route` before `run_shell`; `--local` flag; fallback note |
| `core/src/box.ts` | New: probe, auto host rule, snapshot, patch return |
| `core/src/sessions/launch.ts:68, 78` | `host: 'box'` branch; `isolated` and `work/` refusals |
| `core/cli.ts:30, 427-448` | `--host`, `--easy` on `launch` and `--jobs` entries |
| `core/src/settings.ts` | `box` block with the defaults above |
| `workbench/renderer/app.js` | `box` badge on the tile |
| `contracts/pipe-protocol.md` | `session.launch` params `host`, `easy`; result `host`, `host_reason` |

## Out of scope

- Hook-driven tile state and approvals for box sessions (needs a remote spool reader; follow-up).
- Electron or Playwright QA on the box (needs a display; the box has none set up).
- graphify and Ollama jobs (they need this laptop's GPU).
- Windows-only checks (`tests/windows/*.ps1`).
- Gemini, Copilot, OpenCode and Pi engines on the box (not installed there).
- Moving a running session between machines.
- Replacing the box's own `planner`, `brief` and `email` tmux sessions or crons.
