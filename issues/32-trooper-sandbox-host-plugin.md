# Trooper sandbox host plugin

Child #32 of the MetaTrooper epic. Milestone 2, after the adoption gate. Effort: about 3 Claude Code days
(image and entry script 0.5, `--host sandbox` launcher path and path mapping 0.5, logins and agy keyring
login 0.5, egress proxy 0.5, spool writer and ingest 0.5, self-test and tests 0.5).

Depends on: child #1, child #3, child #4.

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

## Out of scope

- The browser inside the sandbox (child #6 owns the browser).
- Snapshots and rollback, pause and resume, more than one image template.
- A credential vault proxy (tokens kept out of the sandbox); read-only mounts plus the egress allow-list
  instead.
- Cloud or multi-machine sandboxes; adopting AIO Sandbox or CubeSandbox.
- Faster file access than a Windows bind mount (node_modules-heavy projects may be slow).

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4, #6 and #32 (the escape self-test is a security test).
- No em dashes; comments say what the code does, not why.
