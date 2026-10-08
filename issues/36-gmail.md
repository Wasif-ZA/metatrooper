# `gmail` plugin, `prospect-list-to-drafts`, `inbox-triage-drafts`

Part of the MetaTrooper epic. Milestone 3. Effort: about 2 Claude Code days.

Depends on: child #15, child #16, child #23.

## What

`gmail` plugin, `prospect-list-to-drafts`, `inbox-triage-drafts`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic. Nothing is ever sent: both pipelines end in Gmail drafts.

### `prospect-list-to-drafts`

Background: the 36px wall bar, no thumbnail.

- Layouts: coverage-map (lead table), triage (draft queue), preview-stage (inbox preview), pr-first (the batch),
  run-log.
- Opens when `approve-spend` or `approve` waits, or any step fails, including a refused draft. A `check` flag opens
  it only through `approve`.
- Pick, first match: a failure to run-log; `approve-spend` to coverage-map; `approve` with a flag left to triage on
  that draft; `approve` otherwise to pr-first. Opened by hand: pr-first with the hand-back when done, coverage-map
  while a step runs. preview-stage is by hand only.
- Steps (two-engine decision, 2026-10-04): `load`, `approve-spend` (gate, approve, guards `sources`), `sources`
  (external), `hook` (fanout 4), `write`, `check`, `approve` (gate, approve, guards `drafts`), `drafts` (action,
  publish, external).

### `inbox-triage-drafts`

Background: the 36px wall bar, no thumbnail. Spam and injected messages never open it.

- Layouts: triage (reply queue), buckets (piles), preview-stage (thread), pr-first (drafts batch), run-log.
- Opens when `approve` waits, or any step fails, including a refused draft.
- Pick, first match: a failure to run-log; `approve` with a flag left to triage on that reply; `approve` otherwise to
  pr-first. Opened by hand: pr-first with the hand-back when done, buckets while a step runs. preview-stage is by
  hand only.
- Steps (accepted by Wasif 2026-10-05): `rules` (code, ingest), `fetch` (action, ingest, `plugin:gmail/read`),
  `classify` (agent, review, view items), `draft` (agent, worker), `check` (agent, verify), `approve` (gate,
  approve, guards `drafts`), `drafts` (action, publish, external, `plugin:gmail/draft`). The schedule
  `0 8,12,15 * * *` is a schedule row, not a step.

## Acceptance criteria

- [ ] M3-01. Each milestone-3 built-in runs end to end on its fixture and stops at every gate before a publish step.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.

## Helper tools (M4-8) for `prospect-list-to-drafts`

| Helper | Repo | Licence | Risk | Egress | Step it helps |
|---|---|---|---|---|---|
| crawl4ai | unclecode/crawl4ai | Apache-2.0 | OK | not checked (fetches the pages you point it at) | sources |
| gws | googleworkspace/cli | Apache-2.0 | OK | requests go to Google APIs under the user's own auth | drafts |
| reacher | reacherhq/check-if-email-exists | AGPL-3.0 or commercial (dual) | caution: AGPL for open-source use; commercial use needs a paid licence; Docker HTTP backend, no Windows asset | SMTP probes to each address's mail server; needs outbound port 25 | check |

Helpers are optional. Each pipeline runs without them. They are listed in `pipelines/assists/registry.json` once the pipeline is built (registry format in `issues/m4-09-helper-tools.md`).

## Helper tools (M4-8) for `inbox-triage-drafts`

| Helper | Repo | Licence | Risk | Egress | Step it helps |
|---|---|---|---|---|---|
| gws | googleworkspace/cli | Apache-2.0 | OK | requests go to Google APIs under the user's own auth | fetch and drafts |
| google_workspace_mcp | taylorwilsdon/google_workspace_mcp | MIT | OK | requests go to Google APIs under the user's own auth | fetch and drafts |
| himalaya | pimalaya/himalaya | Apache-2.0 | OK | mail goes to the user's own IMAP server | fetch |

Helpers are optional. Each pipeline runs without them. They are listed in `pipelines/assists/registry.json` once the pipeline is built (registry format in `issues/m4-09-helper-tools.md`).

## Ideas (M4-8)

### Requirements

- `prospect-list-to-drafts` `check`: add an address column (`safe`, `risky`, `invalid`, `unknown`, disposable, role account, catch-all) to the coverage map and drop `invalid` and disposable leads before `write`; without reacher, an MX lookup plus disposable and role lists fill most of it (reacherhq/check-if-email-exists).
- `inbox-triage-drafts` `drafts`: store each draft's id and text; next run, replace an unchanged draft on the same thread and leave an edited one alone, noting it (elie222/inbox-zero).
- `inbox-triage-drafts` `rules`: match from, to, subject and label conditions in code; `classify` sees only unmatched mail (elie222/inbox-zero).
- `inbox-triage-drafts` `classify`: the session that reads untrusted mail has read-only Gmail tools; draft tools exist only in `draft` (taylorwilsdon/google_workspace_mcp).

### Notes

- `prospect-list-to-drafts` `check`: if outbound port 25 is blocked every result is `unknown`; say so in one red line (reacherhq/check-if-email-exists). Medium, S.
- `prospect-list-to-drafts` `hook`: give it query-filtered Markdown of each prospect's site, not raw pages (unclecode/crawl4ai, janreges/siteone-crawler). Medium, S.
- Both pipelines `drafts`: replies set `threadId` and subject `Re: ...`; a reply that would start a new thread is refused at `check` (Zie619/n8n-workflows). Medium, S.
- `inbox-triage-drafts`: a `dry: true` run input classifies the last N messages with no drafts written (elie222/inbox-zero). Medium, S.
- `inbox-triage-drafts`: each card shows why it landed in its pile, rule or model reason (elie222/inbox-zero). Medium, S.
- `inbox-triage-drafts` `approve`: when the user re-files a message, offer a one-line static rule, never silent (elie222/inbox-zero). Medium, M.
- `inbox-triage-drafts` plugin setup: request only read, label and compose scopes; unverified apps are limited to about 25 scopes (googleworkspace/cli). Medium, S.
- Gate card before `drafts` shows the request body from a dry-run render (googleworkspace/cli). Medium, S.
- `inbox-triage-drafts` `drafts`: with himalaya configured, stage a draft over IMAP for a non-Gmail account (pimalaya/himalaya). Low, S.
- `inbox-triage-drafts` `classify`: a strict boolean `needs_reply`, and `draft` runs only on true (Zie619/n8n-workflows). Low, S.

## Added requirement (M4-8)

The issue text says the email-check helper is thin. Only reacher met the helper bar and it is AGPL or paid (caution). AfterShip/email-verifier (MIT) is a Go library with no binary and needs a wrapper the user builds. The `check` step must therefore work without any helper (MX lookup plus disposable and role lists).
