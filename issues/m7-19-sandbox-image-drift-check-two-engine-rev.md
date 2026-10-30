# M7-19: Sandbox: image drift check, two-engine review, live checks automated

Part of the MetaTrooper desk epic (becoming Ouros), Milestone 7. Priority: Medium. Effort: not sized. Depends on: M7-5.
Status: open; sandbox stays an experimental flag.

## Source of truth

- ~/.cache/claude-scratch/metatrooper-harden-plan-2026-10-09/plan.html P0 and P1
- ~/.cache/claude-scratch/metatrooper-launch-2026-10-08/launch-plan.html
- status/M2-STATUS.md (M2-08, M2-10, M2-11 TODO)
- core/src/sandbox/checks.ts imageTag()

## What is open

- The image check reads only the version tag, so changed hook code or a changed egress list ships stale and nothing refuses the launch.
- Gemini never read core/src/sandbox/*, sandbox/proxy.js, sandbox/entry.sh or core/src/sessions/launch.ts; the sandbox had a one-engine review.
- The spool close half, the live typed marker (M2-10) and the agy hands-off driver (M2-08) were checked by hand only; the 3 concurrent sessions x 10 stress test was never written.
- FIX-C1, FIX-C9 and FIX-R6 cover the bind mount, CSV quoting and the proxy hole, not drift.

## Acceptance criteria

- [ ] M7-19a. The image carries a label with a hash of the hook dist plus the egress list.
- [ ] M7-19b. A launch refuses with "rebuild" when the label does not match; a test changes one hook file and asserts the refusal.
- [ ] M7-19c. Gemini reads each sandbox file and its verdict is reconciled with Codex's in this issue.
- [ ] M7-19d. The agy hands-off e2e, close-half and typed-marker checks run under METATROOPER_DOCKER_E2E=1.
- [ ] M7-19e. A 3x10 concurrent-session test passes with no hung pty and no leftover container.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for any fix Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
