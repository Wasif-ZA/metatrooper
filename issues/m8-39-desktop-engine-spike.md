# M8-39: Spike agent-desktop and cua-driver as plugin desktop engines

Part of Ouros, Milestone 8. Priority: Medium. Effort: 2.0 CC days. Depends on: M8-38 row 1 (the benchmark), M8-14.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section "Computer use and browser use (2026-11-02)"; spec.md D56, D71, D78.
- Research: scratch `ouros-computer-use-2026-11-02/REPORT.html`.

## What it does

Runs both drivers on the M8-38 benchmark and decides which one Ouros uses on macOS and Linux, where it has no driver.
The built-in driver stays the Windows default unless the numbers say otherwise.

## Measured from source, 2026-11-02

| | vercel-labs/agent-desktop | trycua/cua (`libs/cua-driver`) |
|---|---|---|
| Version read | v1.0.2, `9eb9b29` | nightly 0.38.1, `0cdcec9` |
| Stars, licence | 5,985, Apache-2.0 | 31,477 for the whole repo, MIT |
| Dependency gate if linked | Fails twice (stars, licence) | Passes |
| Surface | CLI and C library, one JSON envelope per command | MCP over stdio, CLI, Python and TypeScript packages |
| Telemetry | None found: no HTTP client in `Cargo.lock`; `TcpStream` appears only in its CDP endpoint and X11 files | PostHog on by default; `CUA_DRIVER_RS_TELEMETRY_ENABLED` turns it off |
| Default on Windows | Headless: semantic actions, no pointer | Background: posted messages or UIA, no fronting |
| Needs real input on Windows | `type`, `right-click`, `double-click`, `triple-click`, `focus`, cursor-moving input | Foreground mode, chosen per call |
| Background keys on Windows | `press` to a non-front app fails closed | Yes where the delivery table allows |
| Evidence | Own test suite; 34 open and 40 closed issues, 24 open match "windows" | Windows matrix: 122/122 rows, 99 delivered, 23 exact refusals (its own CI) |
| macOS and Linux | Both | Both, plus Wayland compositors |

## How a plugin engine must attach

- Separate process, `install: "user"`, an `engines/<id>.json` manifest (`ouros-spec.md` 5c). Never the agent-desktop C library: linking fails the gate.
- Agents never see the engine's own tools. It sits behind the existing tool list and behind `desktop.describe`, `approval.check` and `desktop.act`, because neither driver has a per-window grant ("No permission dialog exists", agent-desktop Windows skill).
- `--headed`, `--force` and cua's `delivery_mode: "foreground"` are refused by the core (D78).
- cua-driver runs with telemetry off and without the AGPL `cua-perception` extension.
- Snapshot, clipboard and screenshot output stays under the same scrub as the built-in driver. agent-desktop's JEV helper stays off because it sends screen descriptions to a model provider.

## Blocked on

- Wasif's yes before either tool is installed (D71, and the install safety run: hash, signature, Defender, advisories, OSV).

## Acceptance criteria

- [ ] M8-39a. Both drivers run the M8-38 fixtures under their no-input modes; snapshot time, success and sentinel results sit beside the built-in driver's in one table.
- [ ] M8-39b. The spike records one pick for macOS and Linux, or records that neither earns a place, with the numbers.
- [ ] M8-39c. A network capture during the cua-driver run shows no outbound call with telemetry off.
- [ ] M8-39d. D71 is updated in spec.md with the result.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Nothing is vendored. No em dashes.
