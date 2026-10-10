# Archived issues

The layout-A workbench design (UI revision, built 2026-10-02 to 2026-10-03). Archived 2026-10-05T13:11+11:00
when the wall and the 15-layout pipeline UI became the baseline (spec.md, Workbench and Pipeline UI). The new
screen work is issues/ui-port-epic.md. Evidence for every criterion stays in UI-STATUS.md.

terminal-core, status-and-notifications, zero-setup-tools and result-panes keep a short live stub in issues/ because their code still runs under the wall. layout-shell and step-list are superseded by the port and have no stub. step-list's
`spec-build-review-handback` screen section moved to issues/ui-port-epic.md.

| File | What it was | Verdict |
|---|---|---|
| ui-revision-epic.md | Epic for terminal-core to result-panes: in-app terminals, layout A, contracts for the terminal pipe, inbox, Resume, panes | prunable: no, kept as design history |
| terminal-core.md | Terminal module, terminal pipe, launch rewrite, migration | prunable: no, kept as design history |
| layout-shell.md | Layout A: session list, big terminal, tile grid, palette, strip, side split | prunable: no, kept as design history |
| status-and-notifications.md | Done-unseen, bell and title, toasts, inbox, Clear status, Resume | prunable: no, kept as design history |
| zero-setup-tools.md | First-launch setup, one-click actions, shell tabs, drag onto terminal | prunable: no, kept as design history |
| step-list.md | Step list under the session row, restyled editor | prunable: no, kept as design history |
| result-panes.md | Item review set, Document, Row table, Findings list; Diff widened | prunable: no, kept as design history |

## Closed 2026-10-08

Closed on GitHub on 2026-10-08. Each file is named for its GitHub issue number. Evidence stays in M1-STATUS.md
and M2-STATUS.md. GitHub issues 1 to 11 were duplicates of 12 to 22 and were closed as such; they have no file.
Their lines were removed from `issues/sync-issues.sh`.

| File | What it was | Verdict |
|---|---|---|
| 12-core-service.md | Core service, done | prunable: no, kept as design history |
| 13-plugin-system.md | Plugin system, done | prunable: no, kept as design history |
| 14-callrouter.md | Callrouter Plan A, done | prunable: no, kept as design history |
| 15-pipeline-runner.md | Pipeline runner, done | prunable: no, kept as design history |
| 16-electron-workbench.md | Electron workbench, done | prunable: no, kept as design history |
| 17-live-browser.md | Live browser, done | prunable: no, kept as design history |
| 18-two-engine-review.md | Two-engine review pipeline and view, done | prunable: no, kept as design history |
| 19-hand-back-tray.md | Hand-back tray, done | prunable: no, kept as design history |
| 20-token-meter.md | Token meter and prices, done | prunable: no, kept as design history |
| 21-troop-cli.md | Agent-native troop CLI and skill, done | prunable: no, kept as design history |
| 22-adoption-measurement.md | Measurement tooling for the adoption gate, done | prunable: no, kept as design history |
| 23-inspiration-board.md | Inspiration board and agent-reach plugin, done | moved to ../suite-of-products (2026-10-10) |
| 24-variants-grid.md | Variants grid, done | moved to ../suite-of-products (2026-10-10) |
| 25-github-and-deploy.md | github and deploy plugins, four pipelines, done | moved to ../suite-of-products (2026-10-10) |
| 30-diff-annotation.md | Diff annotation and file drag, done | prunable: no, kept as design history |
| 28-herdr-host.md | herdr host plugin, dropped 2026-10-02 by UI revision D8 | prunable: yes |

## Archived 2026-10-10 by the desk re-spec

M1 to M5 work for the desk that is done, plus stubs and epics the new spec (Milestone 6) replaced. Pipeline issues
left for `../suite-of-products/` (each product's `issues/`, plus `shared/` and `unassigned/`).

| File | What | Verdict |
|---|---|---|
| 29-usage-limits-and-accounts.md | Usage limits and account switcher, built in M2 and M5 | prunable: no, kept as design history |
| 42-open-core-seams.md | Cloud and gateway refusals, built | prunable: no, kept as design history |
| m4-02-clean-test-suites.md | Test suites clean up after themselves, done | prunable: no, kept as design history |
| m4-06-osc-signal.md | OSC notification signal, done | prunable: no, kept as design history |
| m4-07-fixes-from-real-use.md | Fixes from real use, done | prunable: no, kept as design history |
| m4-11-session-glue.md | Session owners and edit warnings, done | prunable: no, kept as design history |
| m5-00-rebaseline.md | M5 re-baseline, superseded by spec.md Milestone 6 | prunable: no, kept as design history |
| m5-03-first-run.md, m5-04-logs.md, m5-05-linux.md, m5-08-launch-security.md, m5-12-remote-mcp.md, m5-13-catalogue-importers.md, m5-14-engines-as-data.md, m5-19-one-instruction-file.md | M5 desk work, code done | prunable: no, kept as design history |
| sandbox-host.md | Agents-in-Docker design, superseded by M5-D29 | prunable: yes |
| status-and-notifications-live-stub.md, terminal-core-live-stub.md, zero-setup-tools-live-stub.md | Live stubs for done UI revision children | prunable: yes |
| ui-port-epic.md | Wall and pipeline layouts port, done; pipeline half moved out | prunable: no, kept as design history |
| 15-pipeline-runner.md, 18-two-engine-review.md, step-list.md, result-panes.md, spec-2026-09-29-pipeline-ide.md | Moved to ../suite-of-products on 2026-10-10 | gone from this folder |
