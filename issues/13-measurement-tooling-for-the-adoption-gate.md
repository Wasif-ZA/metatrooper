# Measurement tooling for the adoption gate

Child #13 of the Metatrooper epic. Milestone 1. Effort: about 1 Claude Code day.

Depends on: child #5 to child #11, and toolrouter (renamed from callrouter 2026-09-30; repo still
`Wasif-ZA/callrouter`, folder `projects/callrouter`) for A-05.

## Context

After milestone 1 comes a 14-day adoption gate (`spec.md`, Adoption gate, A-01 to A-05). Nothing measures it
yet: no code exists for #13, and the 2026-09-29 baseline scripts were never kept, so only their numbers survive.
#13 is one read-only command that prints all five gate numbers for a date window, as counts only.

## Current state (verified 2026-09-30 on Windows)

| Source | Path | Fields used | Status |
|---|---|---|---|
| Claude prompts | `~/.claude/history.jsonl` | `display`, `sessionId`, `timestamp` (ms epoch) | usable; `project` is the launch folder, so it cannot tell ACU work apart |
| Claude transcripts | `~/.claude/projects/*/<sessionId>.jsonl` | `cwd`, `message.content[].type == "tool_use"` `.input` | usable; older sessions have no transcript left |
| Codex runs | `~/.codex/sessions/**/*.jsonl` | `session_meta.payload.cwd`, `session_meta.timestamp`, `response_item` with `payload.role == "user"`, `payload.type == "function_call"` `.arguments` | usable |
| agy runs | `~/.gemini/antigravity-cli/brain/*/.system_generated/logs/transcript.jsonl` | `type == "USER_INPUT"` `.content`, `created_at`, `tool_calls` | usable; `conversations/*.db` are protobuf and are not read |
| Metatrooper sessions | `troop.db` table `session`, column `native_id` (`contracts/schema.sql:53`) | `native_id` | usable |
| toolrouter calls | `~/.toolrouter/calls.jsonl` (`toolrouter/calls.py:87` `record`) | `time` (local ISO with offset), `project`, `bytes` (full output) | no shown size recorded today |
| toolrouter ingest | `toolrouter/ingest.py` `scan`, `summarise` | per-tool result tokens (`chars // 4`), `--since` only | no `--until`, no saved tokens, no ACU filter |

## Proposed change

### 1. `troop gate`

`troop gate [--since <ISO>] [--until <ISO>] [--json]` in `core/cli.ts`; logic in a new `core/src/gate.ts` exporting
`measureGate(opts: { since: Date; until: Date; home: string; db: DatabaseSync | null; toolrouter: string[] | null }): GateReport`.

- Window is `[since, until)`. Defaults: `until` = now, `since` = `until` minus 14 days.
- `home` is `os.homedir()` in the CLI and a fixture directory in tests.
- Read-only: opens `troop.db` read-only and never writes any file.
- Exit 0 whenever the report was produced, even if a gate fails or inputs were skipped. Exit 1 only on bad
  arguments (section 3a).
- `measureGate`'s `toolrouter` option is the argv prefix to run (`['toolrouter']` in the CLI,
  `[process.execPath, '<fixture>.js']` in tests); `null` gives A-05 reason `toolrouter not found`.

### 2. ACU rule

A session is ACU when its `cwd` matches `/work[\\/]+acu/i`, or any tool call input (Claude `tool_use.input`,
Codex `function_call.arguments`, agy `tool_calls`) serialised as JSON matches the same regex. One rule for all
three engines.

A Claude prompt whose `sessionId` has no transcript file is **unclassified**: excluded from every numerator and
denominator and reported in `counts.unclassified`.

### 3. Definitions (non-ACU, classified, inside the window)

- **A-01** `num` = distinct `sessionId` values from `history.jsonl` found in `session.native_id`; `den` = distinct
  `sessionId` values from `history.jsonl`. Target `value >= 70`. `value = num / den x 100`.
- **A-02** `num` = prompts whose `display` matches `what are you doing|how long|\beta\b|/btw eta|status\?`
  (case-insensitive); `den` = prompts. Target `value < 1`, `value = num / den x 100`.
- **A-03** an engine run is one Codex session file or one agy transcript whose start (`session_meta.timestamp`,
  first step `created_at`) is inside the window and is not ACU. Its first user message is the first user message
  whose text does not start with `<` and does not start with `# AGENTS.md`. `num` = runs whose first user
  message is under 80 characters and matches
  `reply (ready|ok)|name the model|which model|echo|ping|say ok|are you (there|working)` (case-insensitive);
  `den` = runs. Target `value < 3`, `value = num / den x 100`. `engine_check` writes no session file, so nothing
  is excluded for it.
- **A-04** `num` = prompts whose `display` contains `[Image #`; `den` = prompts. Target `value < 0.5`.
- **A-05** from `toolrouter ingest --since <ISO> --until <ISO> --no-save --json`, fields
  `shell_read_tokens` and `saved_tokens` (section 5). `num` = `saved_tokens`; `den` = `shell_read_tokens +
  saved_tokens`; `value = num / den x 100`. Target `value >= 20`. `shell_read_tokens` already contains what
  toolrouter printed, because `toolrouter exec` runs through Bash, so adding `saved_tokens` gives what would have
  been spent without it.

A metric with `den == 0` reports `value: null, pass: null`.

### 3a. Precise rules

**Arguments.** `troop gate` parses its own argv (not the shared `parse()` in `core/cli.ts`). `--since` and
`--until` take `YYYY-MM-DD` (UTC midnight) or `YYYY-MM-DDTHH:MM[:SS]` with optional `Z` or `+hh:mm`/`-hh:mm`
(no offset means UTC). Anything else, `since >= until`, a repeated flag, a flag missing its value, or an unknown
flag prints `troop gate: <reason>` to stderr and exits 1.

**Units.** `counts.prompts` = classified non-ACU prompt lines in the window. `counts.acu` = prompt lines in the
window from ACU sessions. `counts.unclassified` = prompt lines in the window with no transcript.
`counts.engine_runs` = non-ACU Codex plus agy runs in the window. `counts.skipped_lines` = lines skipped as
invalid JSON, non-objects or records with a missing or unparseable timestamp. `counts.unreadable_files` = files
that failed to open or read.

**Claude records.** A `history.jsonl` line counts when it parses as a JSON object with a string `sessionId`, a
string `display` and a numeric `timestamp` (ms epoch). A session's transcript is every file matching
`~/.claude/projects/*/<sessionId>.jsonl`; if several match, all are read and a session is ACU if any of them
matches the ACU rule. The ACU rule scans the whole transcript, not only lines inside the window. A session
whose matching transcript files were all unreadable is unclassified. Tool input is
`JSON.stringify(block.input)` for each `message.content[]` block with `type == "tool_use"`.

**Codex records.** A run is one `*.jsonl` file. Start = `timestamp` of the first line with `type ==
"session_meta"`; a file without one, or whose timestamp does not parse, is skipped and adds 1 to
`counts.skipped_lines`. `cwd` = that line's `payload.cwd`. User text = for lines with
`type == "response_item"`, `payload.type == "message"`, `payload.role == "user"`, the concatenation of
`payload.content[].text` for items with `type == "input_text"`. Tool input = `payload.arguments` (a string) for
`payload.type == "function_call"`.

**agy records.** A run is one `transcript.jsonl`. Start = `created_at` of its first line; a missing or unparseable value skips the run and adds 1 to
`counts.skipped_lines`. User text = `content`
of the first line with `type == "USER_INPUT"` when it is a string, cut to the part after the first `<USER_REQUEST>`
and before the first `</USER_REQUEST>`, `<ADDITIONAL_METADATA>`, `<PLAN>` or `<USER_SETTINGS_CHANGE>` (the whole
content when there is no `<USER_REQUEST>`; to the end when no end tag follows). agy wraps every prompt this way
(312 of 317 transcripts on 2026-09-30). Tool input = `JSON.stringify(tool_calls)` for
every line with a `tool_calls` field. agy has no cwd field, so only the tool-input half of the ACU rule applies.

**First user message.** Take user texts in file order, trim each, skip empty ones, skip ones starting with `<`
or `# AGENTS.md`; the first remaining one is the first user message. A run with none is an engine run that is
not a smoke test. Length is measured after trim, in JavaScript string length.

**A-01 matching.** `SELECT 1 FROM session s JOIN engine e ON e.id = s.engine_id WHERE e.id = 'claude' AND
s.native_id = ?`, i.e. only Claude sessions count. With no `troop.db` (default path from `core/src/paths.ts`),
A-01 is `{ num: null, den: null, value: null, pass: null, reason: "troop.db not found" }`.

**Bad input.** A missing directory or file means zero records from that source. A line that is not valid JSON,
or not an object, is skipped and counted in `counts.skipped_lines`. An unreadable file (permission error) is
skipped and counted in `counts.unreadable_files`. Neither is ever printed by name.

**A-05 subprocess.** `execFileSync('toolrouter', ['ingest', '--since', since, '--until', until, '--no-save',
'--json'], { timeout: 120_000 })`. Any spawn error, timeout, non-zero exit, output that is not one JSON object
with `ok: true`, or a missing numeric `shell_read_tokens` or `saved_tokens` gives A-05 `null` with `reason` set
to one of `toolrouter not found`, `toolrouter timed out`, `toolrouter failed`, `toolrouter output invalid`.

**Numbers.** `value` is the raw float `num / den x 100`; `pass` compares the raw value to the target. The JSON
prints the raw value; the text form rounds to 1 decimal place.

**Text form for null metrics.** `A-05  n/a  target >= 20  (toolrouter not found)`. The `reason` strings above
are the only error text; no path ever appears.

### 4. Output

```json
{
  "window": { "since": "2026-10-01T00:00:00.000Z", "until": "2026-10-15T00:00:00.000Z" },
  "counts": { "prompts": 0, "acu": 0, "unclassified": 0, "engine_runs": 0, "skipped_lines": 0, "unreadable_files": 0 },
  "A01": { "num": 0, "den": 0, "value": null, "target": ">= 70", "pass": null },
  "A02": { "num": 0, "den": 0, "value": null, "target": "< 1", "pass": null },
  "A03": { "num": 0, "den": 0, "value": null, "target": "< 3", "pass": null },
  "A04": { "num": 0, "den": 0, "value": null, "target": "< 0.5", "pass": null },
  "A05": { "num": null, "den": null, "value": null, "target": ">= 20", "pass": null, "reason": "toolrouter not found" }
}
```

Without `--json`, one line per metric: `A-02  3 / 212 = 1.4 per 100  target < 1  FAIL`. No prompt text, path,
command or session id is ever printed, in either form.

### 5. toolrouter change (callrouter repo)

- `cli.finish` stops appending the call row itself and stores it on the result as `r.rec`. `cli.main`, after
  `out = render(r, how_)`, appends `{**r.rec, "shown_bytes": len(out.encode("utf-8"))}`. The flow runner
  (`cli.py`, the loop calling `LANES[verb]` for each step) appends each step's `sr.rec` unchanged, so step rows
  have no `shown_bytes`. Only rows with `shown_bytes` count toward `saved_tokens`, so a flow is counted once.
  Older rows without it count as saving 0.
- `toolrouter ingest` gains `--until <ISO>`; both bounds are parsed with `datetime.fromisoformat` (a value with
  no offset is UTC) and compared as datetimes, not strings, for transcript `timestamp` and call `time`.
- `ingest` skips a transcript session when any of its lines has a `cwd`, or any `tool_use.input`, matching
  `/work[\\/]+acu/i`, and skips a `calls.jsonl` row whose `project` matches it.
- The JSON form adds `shell_read_tokens` (Bash, PowerShell and Read result tokens after the ACU skip) and
  `saved_tokens` (sum of `(bytes - shown_bytes) // 4` over non-ACU `calls.jsonl` rows in the window that have `shown_bytes`,
  floored at 0 per row). A `calls.jsonl` row whose `time` does not parse is skipped. Existing fields are unchanged.
- New `troop-plugin.json` at the callrouter repo root: `schema: 1`, `id: "toolrouter"`, `version: "0.1.0"`, `name: "toolrouter"`, one action `ingest`
  with `run: ["toolrouter", "ingest", "--no-save", "--json"]` and `output_schema`
  `{ "type": "object", "required": ["shell_read_tokens", "saved_tokens"], "properties": { "shell_read_tokens":
  { "type": "integer" }, "saved_tokens": { "type": "integer" } } }`. It must pass `validateManifest` from
  `core/src/plugins/manifest.ts` (M1-29).

### 6. Re-baseline

After #13 lands, Wasif runs `troop gate --since 2026-06-01 --until 2026-09-30 --json` on laptop-ops. The
baseline numbers in `spec.md` (Adoption gate section) are replaced with that output, and the sentence saying
#13 re-runs the 2026-09-29 baseline scripts unchanged is removed.

## Acceptance criteria

1. On a fixture home with known counts for every metric, `troop gate --json` returns exactly those `num` and
   `den` values.
2. A fixture Claude session whose transcript has a `Read` of `work/ACU/x.csv` is counted in `counts.acu` and in no
   metric; the same for a Codex run with `cwd` under `work/ACU` and an agy run whose tool call names `work\ACU`.
3. A fixture prompt with no transcript is counted in `counts.unclassified` and in no metric.
4. A marker string placed in fixture prompts, Codex messages and agy messages appears in neither stdout nor
   stderr, with and without `--json`.
5. A Codex run whose messages are `<environment_context>...`, then `# AGENTS.md ...`, then `reply ok` counts as a
   smoke test.
6. Prompts at exactly `since` are counted and prompts at exactly `until` are not.
7. With `toolrouter` absent from PATH, A-05 is `null` with a `reason`, and the exit code is 0.
8. `toolrouter ingest --since X --until Y --no-save --json` on a fixture: `saved_tokens` counts only
   `calls.jsonl` rows inside the window, excludes a row whose `project` is under `work/ACU`, and a row with no
   `shown_bytes` adds 0; `shell_read_tokens` excludes a session that read a `work/ACU` path.
9. `troop gate --since 2026-10-02 --until 2026-10-01`, `--since x`, `--since a --since b` and `--bogus` each exit 1
   with one `troop gate:` line on stderr.
10. A flow of two steps adds one row with `shown_bytes` and two rows without it to `calls.jsonl`.
11. The core suite and the toolrouter suite pass on Windows.

## Testing plan

| Layer | What | Count |
|---|---|---|
| Unit | `core/test/gate.test.ts`: fixture home per criterion 1 to 7, and 9 | +8 |
| Unit | `tests/test_ingest_gate.py` (callrouter repo): window, ACU skip, `shown_bytes`, flow counted once | +4 |
| Manual | re-baseline run on laptop-ops (section 6) | 1 |

## Rollback

Read-only command, one new call-record field and additive ingest flags. Revert the commit in each repo.

## Effort

0.5 day `core/src/gate.ts` and `core/cli.ts`; 0.25 day toolrouter changes; 0.25 day fixtures and tests.

## Files

| File | Change |
|---|---|
| `core/src/gate.ts` | new: readers, ACU rule, `measureGate` |
| `core/cli.ts` | new `gate` case |
| `core/test/gate.test.ts` | new |
| `toolrouter/calls.py` (callrouter repo) | `record` takes `shown_bytes` |
| `toolrouter/cli.py` (callrouter repo) | `finish` passes `shown_bytes` |
| `toolrouter/ingest.py` (callrouter repo) | `--until`, datetime compare, ACU skip, two new JSON fields |
| `tests/test_ingest_gate.py` (callrouter repo) | new |
| `troop-plugin.json` (callrouter repo) | new |
| `spec.md` | A-05 and M1-29 reworded for toolrouter now; re-baseline numbers after the laptop-ops run |

## Out of scope

- A workbench view of the gate.
- Per-day charts or trend lines.
- Parsing agy `conversations/*.db`.
- Measuring laptop-ops from another machine.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
