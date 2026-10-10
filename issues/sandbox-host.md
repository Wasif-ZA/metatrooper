# Trooper sandbox host plugin

Superseded 2026-10-10 by M5-D29 (spec.md): agents stay on the host; only the code they run goes into a per-project
Docker container, with an Open sandbox button in the workbench. The agents-in-Docker plan below is history.

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

Child sandbox-host of the MetaTrooper epic. Milestone 2, after the adoption gate. Effort: about 3 Claude Code days
(image and entry script 0.5, `--host sandbox` launcher path and path mapping 0.5, logins and agy keyring
login 0.5, egress proxy 0.5, spool writer and ingest 0.5, self-test and tests 0.5).

Depends on: child #12, child #13, child #15.

## What

A container host for troopers, so the `isolated` approval profile can skip every approval inside a boundary
MetaTrooper controls. Built by MetaTrooper from the ideas of AIO Sandbox and CubeSandbox; neither is adopted.

## Source of truth

- `spec.md`, sections "Trooper sandbox host plugin", decisions D41 to D43, and "Milestones and child issues".
- Contracts: `events-and-hooks.md` § "Spool ingest".
- If this issue and the contracts disagree, the contracts win.

## Before starting

- Docker Desktop (WSL2) or Podman installed on the build machine: a hand-back, it needs admin rights and a
  reboot.
- The adoption gate has passed.

## Acceptance criteria

- [ ] M2-08. Hands-off three-engine run on the tinyutils fixture with zero approval and trust prompts.
- [ ] M2-09. Escape self-test: every listed escape fails, every positive check passes.
- [ ] M2-10. The privacy marker reaches no table, log, spool file or WAL.
- [ ] M2-11. Closing the window removes the container; a core restart ingests spooled events in order.
- [ ] M2-12. Each refusal case starts nothing and states its reason.

## Build plan (agreed with Wasif 2026-10-08)

Built on branch m2-harden. Today `session.launch` refuses every host but `pty` (`core/src/methods.ts:89`).

### Decisions

- D1. When a sandboxed session ends (window closed, step ended, process gone), the core runs
  `docker rm -f troop-<id8>`. Killing the docker client does not stop its container, so `--rm -it` alone leaves it
  running. Cost: a core crash ends the agent's turn; M2-11 keeps only "spooled events are ingested in order after
  restart".
- D2. Each login file is mounted read-only at `/troop/logins/<engine>/<file name>`, and `entry.sh` links it into
  `~/.claude` or `~/.codex`. A bind mount at `~/.claude/...` would make Docker create `~/.claude` owned by root,
  and the engine could not write its own settings.
- D3. Claude and Codex first; agy is the last slice. M2-08 stays open until it lands.
- D4. The code is a core module (`core/src/sandbox/`) plus a top-level `sandbox/` folder (Dockerfile, `entry.sh`,
  `proxy.js`, `selftest.js`). The plugin manifest has no host extension point.
- D5. `isolated` runs only in a MetaTrooper worktree (the project's working tree is never mounted); anywhere
  else is refused.
- D6. `.git/hooks` and `.git/config` of the main repo are mounted read-only over the writable `.git`, so nothing
  an agent writes runs on the host at the next git command. Accepted risk: an agent can still move other refs in
  the shared `.git`.
- D7 (Codex review 2026-10-08). The worktree's own `.git` pointer file is also mounted read-only, so an agent
  cannot point the host's next `git -C <worktree>` at a gitdir whose config it wrote. With `.git/config`
  read-only, `include`, `core.hooksPath`, `core.fsmonitor` and `extensions.worktreeConfig` cannot change.
- D8 (Codex review). The spool writer (S4) lands before the launch path (S3): no sandboxed session runs while
  its events would go nowhere.
- D9 (2026-10-08). No `--relative-paths`: Debian 12 has git 2.39, and the flag adds an `extensions` entry to the
  host repo that older git tools refuse. The container gets `GIT_DIR=<mapped .git/worktrees/name>` and
  `GIT_WORK_TREE=<mapped worktree>` instead, which any git version reads; nothing in the host repo changes.

### Slices

| # | Slice | Criteria | Effort |
|---|---|---|---|
| S1 | Registry `sandbox` data and `isolated` profiles (claude `--dangerously-skip-permissions`, codex `--dangerously-bypass-approvals-and-sandbox`). `session.launch` refuses: `isolated` on `pty`, image not built, Claude login expiring within 60 minutes or `codex login status` failing, an ACU path, not a MetaTrooper worktree. Unit test: no bypass flag in any other profile. | M2-12 | 0.5 d |
| S2 | Image (Debian 12 slim, node 24, git 2.48+, user `trooper` uid 1000, hook scripts in `/opt/troop`). `troop sandbox build` builds it, creates the `--internal` network `troop-egress`, and starts `troop-proxy` (allow-list CONNECT proxy, 403 otherwise, denied host names to `egress-denied.log`). The proxy refuses IP literals and any allowed name that resolves to a loopback, private or link-local address. | M2-09 part | 0.75 d |
| S3 | Launch path: the core builds the `docker run` argv in spec.md (plus D2 and D6 mounts), maps `C:\a\b` to `/host/c/a/b`, points hook settings and the Codex notify line at `/opt/troop`, and runs D1 at session end. Before launch it refuses unless the worktree's `.git` pointer and its gitdir resolve inside the mapped mounts. At pty exit: session `exited`, final spool drain, `docker rm -f`, spool folder deleted, in that order. Runs after S4 (D8). | M2-11 close half | 0.5 d |
| S4 | Spool: the event writer appends to `$METATROOPER_SPOOL/events.ndjson` when set; the core ingests every 250 ms per the contract (64 KiB line cap, re-redaction, offset in `meta`, 10 MiB stop, folder deleted after exit). | M2-10, M2-11 | 0.5 d |
| S5 | `troop sandbox selftest`, with the D6 checks (writing a hook and `.git/config` fail) added to M2-09's list. Codex writes the tests. | M2-09 | 0.5 d |
| S6 | Fixture `tests/fixtures/tinyutils` (3 seeded bugs); hands-off `troop launch --jobs` with Claude and Codex. | M2-08, 2 of 3 | 0.25 d |
| S7 | agy: keyring volume, `troop sandbox login agy`, its isolated flags. | M2-08 | 0.5 d |

Each slice is one commit on m2-harden and one M2-STATUS.md update. Done when M2-08 to M2-12 are VERIFIED-WINDOWS,
each with a test that fails when its behaviour breaks. Rollback: revert the branch; `pty` sessions are unchanged,
and nothing in a host repo changes (D9).

## Out of scope

- An agent that keeps working while the core is down (D1).
- Per-branch protection of refs in the shared `.git` (D6).
- The browser inside the sandbox (child #17 owns the browser).
- Snapshots and rollback, pause and resume, more than one image template.
- A credential vault proxy (tokens kept out of the sandbox); read-only mounts plus the egress allow-list
  instead.
- Cloud or multi-machine sandboxes; adopting AIO Sandbox or CubeSandbox.
- Faster file access than a Windows bind mount (node_modules-heavy projects may be slow).

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15, #17 and sandbox-host (the escape self-test is a security test).
- No em dashes; comments say what the code does, not why.
