# M5-16 Issue-tracker trigger plus gated write-back

Child of Milestone 5 in `spec.md` (Milestone 5: launch). Decisions M5-D1 onward and the launch scope are
there; this file is what to build. Tag: M5, after 12-01. Source: the integrations scan of 2026-10-09 (registry, npm,
PyPI and rival-desk evidence, ranked list in `ide-layer-research/m5-integrations-demand.md`).

The after-launch parts of this file are a design sketch, not a build spec: before building, it is re-specced and
scored by the Codex gate like every M4 child.

**Unlocks:** #1 GitHub issues, #5 Linear, #6 Jira, #19 GitLab as pipeline triggers. The Cursor and Devin pattern
("start an agent from a ticket") without a public URL.

**How.** Poll, do not listen. A webhook needs a public URL; polling runs on the existing tick.

- A plugin action can be marked a trigger. The core calls it on the 30 s schedule tick (`main.ts:114`) at its own
  `poll_seconds`, gets `{"items": [...]}`, and starts the named pipeline once per new `item.id`.
- New table `trigger_item (trigger_id, item_id, seen_at, run_id)` so an item never starts twice.
- `run.trigger` CHECK gains `issue` (`schema.sql:146`, `runner.ts:72`).
- First trigger: `github` plugin `list-issues` over `gh issue list --label <label> --json` (gh is present and the
  plugin exists). Then Linear (GraphQL, `secrets:LINEAR_API_KEY`), Jira (REST, `secrets:JIRA_API_TOKEN`), GitLab
  (`glab`).
- Write-back (comment on the issue, move its status, link the PR) is a normal action with `external: true` and
  `destination_field: "issue"`.

**Manifest addition** (inside `$defs.action`):

```json
{
  "trigger": {
    "type": "object",
    "required": ["pipeline", "poll_seconds"],
    "properties": {
      "pipeline": { "type": "string" },
      "poll_seconds": { "type": "integer", "minimum": 60, "maximum": 86400 },
      "authors": { "type": "array", "items": { "type": "string" }, "description": "Only items opened by these accounts start a run." }
    }
  }
}
```

with the output contract fixed by the core:
`{"items": [{"id": str, "title": str, "url": str, "author": str, "body": str, "labels": [str]}]}`.

**Security rules**

- An issue body is untrusted input. It is written to the run directory as `issue.json` and handed to steps as data,
  never pasted into an engine prompt as instructions.
- `authors` is required when the source is a public repo. Without it, anyone on the internet could start agent
  work on Wasif's laptop.
- A trigger never skips a gate: every external step in the started run still needs a person on the trusted UI.
- Poll actions are read-only (`external` must be false); the validator refuses a trigger that is also external.
- A rate cap: at most N runs per trigger per hour (default 3), extra items raise a needs-you row.

**Files to change:** `contracts/plugin-manifest.schema.json` (`action` def), `contracts/schema.sql`
(`trigger_item`, `run.trigger`), `core/src/schedules.ts` (poll alongside cron), `core/src/pipelines/runner.ts:72`,
`plugins/github/troop-plugin.json` and its `bin/` (`list-issues`, `comment-issue`), `contracts/pipelines.md`.

**Effort:** 2.5 CC days for the mechanism plus GitHub; about 1 more per tracker (Linear, Jira, GitLab).

**Acceptance tests**

- M5-16a: a fake `list-issues` returning two items starts two runs with `trigger = 'issue'`; the next poll with the
  same items starts none.
- M5-16b: an item whose author is not in `authors` starts no run.
- M5-16c: the started run's external step stops at a gate; no code path approves it.
- M5-16d: a manifest with `trigger` on an `external: true` action fails validation.
