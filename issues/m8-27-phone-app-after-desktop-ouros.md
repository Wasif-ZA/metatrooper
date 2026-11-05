# M8-27: Phone app (after desktop Ouros)

Part of Ouros, Milestone 8. Priority: Low. Effort: not sized (sized after M8-0). Depends on: M8-4, M8-22.
Status in scratch: round 2 verdict pending; round 1 superseded.
**Start on or after 2026-11-09.**

## Source of truth

- `spec.md` Milestone 8 row M8-27; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): kit/PHONE.html; kit/mobile2.html?s=home|gate|ask|live|done|diff|usage|new|lock|pair; research/phone/APPS.md, CRAFT.md; kit/shots/phone2.

## What was designed

- Ten phone-native screens from 11 apps' research and 25 craft rules: 17px rows, 28px titles, 16px margins, spacing not borders, one big action per screen, orange only for needs you, code edge to edge at 13px.
- Home is one list: Needs you on top (the only orange), then Working, then Today, composer at the bottom.
- A stop-list gate is a sheet with the exact command and hold-to-confirm; Face ID for stop-list gates.
- Question card with options plus free text; follow and steer with steps, a log tail with Jump to latest, and a queued bubble; finished run as one card with checkpoint rows; review with a floating Keep and Undo beside it.
- Usage page, start-a-task sheet (project, branch, agent, mode chips), lock-screen push with live agents, first-launch pairing. Code and keys stay on the PC; the phone is a remote.
- 2026-11-05: alerts come first without this app: M8-F23. The screen is `n14-machines.json`. Its pairing row still belongs here.

## Blocked on

- PHONE.html round 2 verdict and its 3 calls (tabs vs one list; which gates reach the phone; notifications for needs-you only or finished runs too).

## Acceptance criteria

- [ ] M8-27a. All ten screens draw from catalogue JSON at 390px with no sideways scroll.
- [ ] M8-27b. Hold-to-confirm cannot fire on a single tap.
- [ ] M8-27c. A lock-screen gate opens the app and needs Face ID.
- [ ] M8-27d. Pairing takes one command on the PC.
- [ ] M8-27e. Only needs-you items are orange.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
