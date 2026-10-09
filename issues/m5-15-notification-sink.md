# M5-15 One notification sink for needs-you and gates (outbound only)

Child of Milestone 5 in `spec.md` (Milestone 5: launch). Decisions M5-D1 onward and the launch scope are
there; this file is what to build. Tag: BLOCKER (outbound); inbound approvals wait for the cloud relay epic. Source: the integrations scan of 2026-10-09 (registry, npm,
PyPI and rival-desk evidence, ranked list in `ide-layer-research/m5-integrations-demand.md`).

**Unlocks:** #4 Slack, #14 Teams, #15 Discord, #16 ntfy, plus any webhook, plus about 100 services through Apprise.

**How.** One small core module, one tick, no change at the 8 places that insert `needs_you`:

- Add `needs_you.notified_at`. Every 2 s, `notify.ts` reads `needs_you WHERE notified_at IS NULL AND kind IN
  (<kinds the user chose>)`, sends to each enabled sink, then sets `notified_at`.
- Sink kinds:

| Kind | Sends |
|---|---|
| `ntfy` | POST `<server>/<topic>` with `Title`, `Priority`, `Click: metatrooper://needs-you/<id>` |
| `slack-webhook` | POST `{"text": ...}` to an incoming webhook URL |
| `discord-webhook` | POST `{"content": ...}` |
| `teams-workflow` | POST an Adaptive Card to a Workflows "When a Teams webhook request is received" URL. Not O365 connectors, which Microsoft is retiring |
| `webhook` | POST `{"schema":1,"kind","id","text","at","link"}` |
| `command` | argv with no shell, message on stdin (for example the user's own `apprise` CLI) |

- The workbench registers `metatrooper://` so the link opens the right needs-you item (`app.on('second-instance')`
  already exists at `workbench/src/main.ts:683`).

**Reconciling with "posting to a team channel is external and needs a gate":**

- The **sink is the approved action.** `notify.sink.set` is `needsUi`, so only a person on the trusted UI can add or
  change one. The approval is bound to the sink's destination hash; changing the URL or topic needs approval again.
- The **content is not agent-chosen.** A fixed core template: kind, a one-line text, the link. It goes through
  `core/src/redact.ts`. Never diffs, run outputs, prompts, file contents or paths beyond the project name.
- So individual sends need no per-message gate. Any agent-written message to a channel (a pipeline "post the
  summary to Slack" step) is a plugin action with `external: true` and `destination_field: "channel"`, gated as
  today.

**Approval from a phone or Slack: not at launch.** Approval needs a trusted UI connection (`spec.md:507-509`), D40
puts phone control in v3, and a Slack button click needs a public URL, which a laptop does not have without the
cloud relay. After launch, the rules:

1. A per-gate one-time token made by the core, bound to `gate.id` plus `action_hash`, sent only in the outbound
   message. Never in `needs_you.text`, never on disk, never in any pipe reply.
2. The core accepts it only on its own outbound subscription (for ntfy, a reply topic the core long-polls), never
   on a pipe method, so the `troop` CLI and plugin actions cannot submit one.
3. **The approval channel must not be one an attached MCP server can read.** If the Slack MCP is attached to an
   engine, Slack is not an approval sink for that engine's runs; the install screen and `notify.sink.set` refuse
   that pairing. Otherwise an agent could read its own token and approve its own gate.
4. Approving a stale `action_hash` fails exactly as `gate.resolve` does (`methods.ts:316`).

**Files to change**

- new `core/src/notify.ts`; `core/src/main.ts:91-125` one more `every(2000, ...)`
- `contracts/schema.sql:108-117` (`notified_at`); new `notify_sink` table `(id, kind, name, dest_hash, kinds,
  enabled, approved_at)`
- `core/src/methods.ts`: `notify.sink.set|list|test|remove`; `set`, `test` and `remove` are `needsUi`
- `core/src/plugins/manifest.ts:45-48`: add the `notify.sink.*` writers to `PANE_FORBIDDEN_METHODS`
- `core/src/secrets.ts`: webhook URLs and ntfy tokens stored under the pseudo-plugin id `core-notify`
- workbench settings pane; `contracts/events-and-hooks.md`

**Schema addition** (settings, not the plugin manifest):

```json
{
  "id": "team-slack",
  "kind": "slack-webhook",
  "secret": "SLACK_WEBHOOK_URL",
  "kinds": ["gate", "handoff", "run-failed", "budget", "missing-secret"],
  "quiet_hours": "22:00-07:00",
  "enabled": true
}
```

**Delivery rules.** Each row is sent at most once per sink; it counts as delivered on any 2xx reply (or exit 0 for
`command`). On failure the core retries after 10 s, 60 s and 5 minutes, then sets `notified_at` with a `failed` mark
and raises one `notify-failed` needs-you row per sink per hour. Rows go out oldest first. Rows older than 24 hours
when the core starts are marked and not sent, so a laptop that slept for a week does not flood a channel.

**Effort:** 2 CC days (table and tick 0.5, six sink kinds 0.75, UI methods and redaction 0.5, tests 0.25).
Inbound approvals later: 3 CC days, after the cloud relay decision.

**Acceptance tests**

- M5-15a: a new `gate` needs-you row produces exactly one POST to a local fake webhook within 4 s, and none on the
  next tick.
- M5-15b: the POST body contains the kind, the text and `metatrooper://needs-you/<id>`, and none of: the gate's
  action args, the run directory, any stored secret value.
- M5-15c: `notify.sink.set` over a pipe connection without `ui.hello` fails with `NEEDS_UI`.
- M5-15d: the webhook URL never appears in the database, `log.jsonl` or `~/.metatrooper/` outside its `.dpapi` file.
- M5-15e: core down for 10 minutes, then up: rows raised before the restart are sent once, not repeated.
