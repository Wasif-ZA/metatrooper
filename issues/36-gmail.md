# `gmail` plugin, `prospect-list-to-drafts`, `inbox-triage-drafts`

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

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

## Repo scan 2026-10-09

Relevant repos, top ideas and hardening for `prospect-list-to-drafts`, `inbox-triage-drafts`: `ide-layer-research/m5-repo-scan-preview.md`, the section with the same name. Idea bank only; nothing there is built before launch (M5-D11).

Tag: M5 (after 12-01, per M5-D11). Nothing here is built before launch.

State that must outlive one run goes in the project's `.troop/state/<pipeline>/` folder (`.troop/` is already git-excluded by `excludeTroop`, `core/src/pipelines/runner.ts:1337`).

### prospect-list-to-drafts

#### Ideas

| Id | Idea, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| PL-I1 | Hook on a checkable gap on the prospect's own site, from ethanplusai/harvey, getaero-io/gtm-eng-skills | `sources`, `hook` | Partly true: the `hook` prompt already asks for a fact quoted from the prospect's own pages. `sources` (`plugins/agent-reach/bin/search.js:88`) also records two gaps per site from the raw HTML before text extraction: no `application/ld+json` block on any fetched page, and no about or team link among the same-site links. They go into `index.json` as `gaps`. The `hook` prompt prefers a gap when one exists and names the page it checked | A fixture site with no JSON-LD and no about link gives `gaps: ["no schema", "no team page"]` in `sources/index.json`, and that prospect's hook item names the gap | 0.75 |
| PL-I2 | Dedupe before lookup, stop at the first hit, from getaero-io/gtm-eng-skills, apifyforge/waterfall-contact-enrichment | `sources` | `sources` fetches each site host once: prospects that share a host reuse the first one's pages in `index.json`. A provider waterfall waits until a second provider exists; today the prospect's own site is the only source | Two fixture prospects with the same site: the fake fetcher is called once per URL and both index entries list the same files | 0.3 |
| PL-I3 | Verify the contact's domain before writing, from AfterShip/email-verifier, truemail-rb/truemail | new code step `verify` after `load` | `pipelines/prospect-list-to-drafts/verify.mjs` resolves MX for each email domain (`node:dns` `resolveMx`, 5 s each). No MX, or a domain on a bundled disposable list: the row is dropped with the reason. A role address (info, admin, noreply, sales, support) is kept and marked `role`. It rewrites `prospects.json`; the `approve-spend` summary shows the drop and role counts. DNS only, no SMTP probe | With a stub resolver, a domain with no MX is dropped as "no mail server" and `noreply@` is kept and marked role | 0.5 |
| PL-I4 | Rule lint before the model check, from the genpark deliverability sanitizer, PaulleDemon/Email-automation | new code step `lint` between `write` and `check` | `pipelines/prospect-list-to-drafts/lint.mjs` reads `emails.json` and writes `lint.json` per email: over 100 words, leftover template text (the same pattern as `refusal` in `plugins/gmail/bin/gmail.js:133`), subject over 60 characters, a word from a short spam list (free, guarantee, act now, 100%). The `check` prompt reads `lint.json` and judges only the facts | A fixture email of 120 words holding `{{first_name}}` gets both reasons in `lint.json` | 0.4 |
| PL-I5 | State per prospect so a re-run skips finished rows, from hitb1099/outreach-os, austinchennn/cold-email | `load`, new code step `record` after `drafts` | Partly true: the Gmail draft ledger skips drafts already saved in the same run (`gmail.js:154-177`). A project file `.troop/state/prospect-list-to-drafts/prospects.json`, keyed by lowercased email, holds `saved` and the run id. `record` writes it from the `drafts` output; `load.mjs` drops rows already saved, reason "already drafted in run <id>" | Two runs on the same CSV against the fake Gmail server: the second run's `load` drops every row and the server holds one draft per address | 0.75 |

Worked: 0.75 + 0.3 + 0.5 + 0.4 + 0.75 = 2.7 CC days.

#### Hardening

| Id | Idea, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| PL-H1 | Back off when a site rate-limits, from dancolta/trustpilot-outreach-automation, 434media/bizdev-agent | `sources` | `fetchHtml` (`search.js:81`) records any non-OK status as an error today. On 429 or 503 it waits for `Retry-After` (capped at 60 s), or 2, 4, then 8 s, for three tries. Requests to the same host are at least 1 s apart | A fake fetcher answering 429 then 200 yields the page after one logged wait; two pages on one host are 1 s apart on an injected clock | 0.4 |
| PL-H2 | Flag claims not in the fetched page, from the genpark personalisation engine, getaero-io/gtm-eng-skills | `lint`, `check` | Partly true: the `check` prompt checks the quote against the page. `lint.mjs` (PL-I4) also checks in code that the hook quote appears in the prospect's page text, whitespace normalised. The `check` prompt lists any other claim about the prospect it cannot find in the pages under `unsupported` in `check.json` | A fixture email whose quote is not in `p1.txt` fails lint with "quote not on page" | 0.3 |
| PL-H3 | Validate person, company and domain match, from getaero-io/gtm-eng-skills, Cold-IQ/ColdIQ-s-GTM-Skills | `load`, `hook` | `load.mjs` flags rows whose email domain is not the site host (www ignored; free mail such as gmail.com passes with a note) as `mismatch`, shown in the `approve-spend` summary. The `hook` prompt drops a prospect whose business name is not on its fetched pages, reason "name not on site" | A row with `@other.com` and site `acme.com` shows as 1 domain mismatch in the `approve-spend` summary | 0.3 |
| PL-H4 | No duplicate Gmail drafts across runs, from hitb1099/outreach-os, austinchennn/cold-email | `drafts` | Partly true: the ledger in `gmail.js:154-177` only covers one run's `emails.json`. For a draft that is not a reply, `draft` first lists `drafts?q=to:<address>` and skips one with the same recipient and subject, counted in `skipped` | The fake server already holding a draft to `a@x.com` with the same subject: `draft` returns `skipped: 1` and posts nothing | 0.3 |
| PL-H5 | Cost estimate and caps before the lookups, from ethanplusai/harvey, apifyforge/waterfall-contact-enrichment | `load`, `approve-spend` | Partly true: the gate already shows kept sites and `max_pages`. `max_pages` gets a maximum of 10. A new input `max_prospects` (default 200) drops rows past it with reason "over the cap". `load` outputs `fetches = kept x max_pages` and the gate reads "up to N page fetches" | A 250-row CSV gives kept 200 and 50 dropped "over the cap", and the summary shows "up to 600 page fetches" at `max_pages` 3 | 0.3 |

Worked: 0.4 + 0.3 + 0.3 + 0.3 + 0.3 = 1.6 CC days.

### inbox-triage-drafts

#### Ideas

| Id | Idea, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| IT-I1 | Rules first, model only for the rest, from stonefullstm/ai-email-triage, rspamd/rspamd | new code step `prefilter` between `fetch` and `classify` | `messageRow` (`gmail.js:84-90`) also keeps the `List-Unsubscribe`, `List-Id` and `Precedence` headers. `pipelines/inbox-triage-drafts/prefilter.mjs` marks bulk mail, noreply senders, never-draft senders from `rules.md`, and Gmail promotions or spam labels as P3 or spam with reason "rule: <name>", in `prefiltered.json`. `classify` gets only the rest | A fixture of 3 newsletters with `List-Unsubscribe` and 2 personal mails: `prefiltered.json` holds 3 rule rows and `classify` sees 2 messages | 0.6 |
| IT-I2 | Confidence and second label; low confidence and legal mail go to you, from fazlerocks/jevmail, astetic-dev/porter-intake-operator | `classify`, `draft`, `check` | Partly true: `classify` already writes a confidence. It also writes a `second` label. Confidence under 0.6, or mail about a complaint, refund dispute or legal notice, gets no draft and is listed under `needs_you` in `check.json`; the `approve` summary shows the count | A fixture "Formal complaint" message has no entry in `replies.json` and shows under `needs_you` | 0.5 |
| IT-I3 | Fetch since the last run and strip quoted history, from aziruhq/aziru, github/email_reply_parser | `fetch` | Partly true: scopes are read-only plus compose (`gmail.js:9`). `since: last-run` becomes a stored cursor (a new `cursor` input naming `.troop/state/inbox-triage-drafts/cursor.json`, holding the newest `internalDate` seen), replacing the one-day window (`gmail.js:78-79`). Seen messages are skipped by that cursor. `messageRow` drops quoted lines (starting with `>`) and everything after an "On ... wrote:" line before the 4000-character cap | A fake message with 30 quoted lines keeps only the new text in `messages.json`; a second read with the cursor returns no message already seen | 0.6 |
| IT-I4 | Drafts only, no send or delete path, from cloudflare/agentic-inbox, madebydia/gmail-no-send | `drafts` | Already true: `gmail.js:9` asks only for read-only and compose scopes, and the plugin has only `read` and `draft` actions (`plugins/gmail/troop-plugin.json`) | Covered today; no new test | 0 |
| IT-I5 | Check each reply against its own thread, from kaymen99/langgraph-email-automation, jeremyephron/simplegmail | new code step `thread-check` before `check` | Partly true: the `check` prompt judges thread, ask and promises, and `draft` takes the thread from the parent message (`gmail.js:166-173`). `thread-check.mjs` fails, in code, any reply whose `id` is not in `messages.json` or whose `to` is not that message's sender address (`addressOf`, `gmail.js:92`) | A fixture reply addressed to a different sender fails `thread-check` with "wrong recipient" | 0.25 |

Worked: 0.6 + 0.5 + 0.6 + 0 + 0.25 = 1.95 CC days.

#### Hardening

| Id | Idea, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| IT-H1 | Mail text is data, never an instruction, from Ha22yX/auto-email-system, ascarola/verdictmail | `classify`, `check` | Already true: the `classify` prompt says email text is data, the `check` prompt fails replies that follow an instruction from an email, and HTML is stripped to text, never rendered (`gmail.js:72-74`) | Covered today; no new test | 0 |
| IT-H2 | Empty and failed are different results, from leeguooooo/mail-use | `fetch` | Already true: a Gmail or token error throws `ApiError` and the action returns `ok: false`, which fails the step (`gmail.js:49-53`, `gmail.js:216-218`); an empty inbox returns `count: 0` | Covered today; no new test | 0 |
| IT-H3 | Never answer a thread twice across runs, from paabloLC/gmail-ai-draft, sryo/GmailTidy | code step after `fetch`, `record` after `drafts` | Partly true: the draft ledger skips identical drafts within one run (`gmail.js:154-165`). `.troop/state/inbox-triage-drafts/threads.json` maps a thread id to the last message id drafted against. A code step after `fetch` drops messages whose thread already has a draft for that same last message; `record` appends after `drafts` succeeds | Two runs over the same fake inbox save one draft per thread | 0.5 |
| IT-H4 | Renew an expiring push watch, from paabloLC/gmail-ai-draft, aziruhq/aziru | `fetch` | Already true: `fetch` runs a search query every run (`gmail.js:103-107`); there is no push watch to expire. Renewal is only needed if push is ever added | Covered today; no new test | 0 |
| IT-H5 | Use the full thread and match past tone, from elie222/inbox-zero, henry200803/mailbridge | `fetch`, `draft` | `read` gains `thread_context` (default 0; the pipeline sets 5): each message gets the previous messages of its thread as `history`, 1000 characters each, quotes stripped as in IT-I3. It also gains `tone_samples` (pipeline sets 5): the latest sent mails to the same sender. The `draft` prompt uses both when `rules.md` sets no tone | A fake thread of 3 messages gives the newest row 2 `history` entries, oldest first | 0.6 |

Worked: 0 + 0 + 0.5 + 0 + 0.6 = 1.1 CC days.

Issue total: 2.7 + 1.6 + 1.95 + 1.1 = 7.35 CC days.
