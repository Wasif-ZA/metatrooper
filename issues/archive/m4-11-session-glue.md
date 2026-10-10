# M4-11 Session glue: who owns which file, and who hears about it

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

Child of Milestone 4 in `spec.md` (Milestones and child issues). The decisions for this child are below,
because `spec.md` had uncommitted edits from another session when this was written (2026-10-07T21:20+11:00).

## Why

Several sessions work in one checkout at once. Today a person (or Claude in a separate chat) does the
glue by hand: tracks which session changed which file, warns a session before it edits another one's
uncommitted work, sequences commits ("commit only those hunks after 62 lands"), and carries a side
session's result back to the session that spawned it. The core already sees every session; it should
do this itself.

Evidence, `projects/metatrooper` at 2026-10-07T21:10+11:00: 30 uncommitted paths, 8 Claude sessions
live. Matching `git status` against Edit/Write/MultiEdit hook events left **15 of 30 paths with no
owner**. Two causes, both in `core/src/hook/event.ts` and `core/src/redact.ts`:

1. `event.ts` returns early when `TROOP_SESSION_ID` is unset, so a Claude session opened outside
   MetaTrooper leaves no trace.
2. Only Edit, Write and MultiEdit carry a `file_path`. Edits made through Bash (sed, python, a
   generator) never name a file.

Every owner of the remaining 15 had already exited, so the tree held another session's work that
nothing would commit.

## Decisions

| Id | Decision | Why |
|---|---|---|
| G-D1 | Ownership comes from git, not from hook events. Hook `file_path`s only break ties | The evidence above: hooks miss half the files |
| G-D2 | Claude sessions opened outside MetaTrooper are adopted as `host = 'external'` sessions (Wasif, 2026-10-07T21:15+11:00). Sessions it launched keep `host = 'pty'` | Half the files in the evidence came from sessions nobody launched through troop. An external session shows on the wall but cannot be focused, typed into or closed |
| G-D3 | Claims are `event` rows (`source = 'core'`, `kind = 'core.claim'`). No new table | The event log is already the core's record; a claim is an event |
| G-D4 | Notices travel as `comment` rows (`kind = 'notice'`), delivered by the existing `deliverComments` on the next `UserPromptSubmit`. No new delivery path | The channel exists and is tested |
| G-D5 | Ownership is per file, not per hunk. A file with two live owners is flagged "shared, stage by hand" | Hunk attribution needs a diff of diffs per turn; file level covers every case seen so far |
| G-D6 | Notices name a session by its terminal title and 8-character id. Vault surface ids (`teehee-62`) are not mapped | MetaTrooper is not vault-specific; the title is what the person sees on the wall |
| G-D7 | Only Claude is adopted when external. Codex and agy outside troop stay invisible | Only Claude's hooks run for every session; Codex's notify hook is per launch |

## Built differently from the table below (2026-10-09T07:54+11:00)

- G1: the hook never writes `session`, because schema.sql makes the core its only writer. The hook appends the
  event with `session_id` NULL, and only when its `session_id` is a known `native_id` or its `cwd` is inside a
  registered project; the core adopts it as an `external` session while processing events. An external session
  ends on `claude.SessionEnd` and is skipped by the 5 s pid check, which would otherwise end it after 15 s.
- Schema stays at user_version 2. The new CHECK values (`external`, `notice`, needs_you `uncommitted`) are added
  by rebuilding stale tables at open, as the sandbox host was; `parent_id` and `event_kind_idx` are added in place.
- G2 also marks a file shared when an earlier claim by a live session is still uncommitted, so a non-overlapping
  second editor does not silently take the first one's work.
- Every git call the core makes for ownership runs with `GIT_OPTIONAL_LOCKS=0`, so it never refreshes the index
  under a user's own `git commit`.
- Tests are by Claude: Codex was not available in the cloud session that built this.

## What to build

| Id | Change |
|---|---|
| G1 | **Adopt external sessions.** In `event.ts`, when `TROOP_SESSION_ID` is unset and the kind is a `claude.*` hook with a `session_id` in the payload: look up `session` by `native_id`; if absent, insert one with `host = 'external'`, `engine_id = 'claude'`, `cwd` from the payload, `project_id` from the registered project whose folder contains `cwd` (none: skip, no row). Schema v3: `session.host CHECK (host IN ('pty','external'))`, migrated with the same rebuild as v2 in `core/src/store/db.ts`. The wall shows external rows with an "outside" tag; focus, type and close are disabled for them; state comes from hooks as today |
| G2 | **Claims from git.** At `UserPromptSubmit` the processor already sets `turn_base` (`markTurnBase`, `core/src/events/processor.ts`) for any session row, so adopted sessions get one too. At `Stop` and `SessionEnd`, the processor runs `git diff --name-only <turn_base>` plus `git ls-files --others --exclude-standard` in the session's `cwd` (5 s timeout; not a repo: skip). `stash create` never holds untracked files, so an untracked path counts only when its mtime is after the turn's `UserPromptSubmit` time. The processor then appends a `core.claim` event `{files, turn_base, at}`. A file changed during the turn is claimed by this session when no other session in the same repo had a turn open over the same interval. When one did, the file goes to the session whose hook events name it; with no hint, the claim lists both as `shared` |
| G3 | **Owners query.** `owners(repo)` in `core/src/sessions/` returns, per path in `git status --porcelain`, the latest claim for it: owner ids, owner state, `shared`, or `unclaimed`. A path committed since its claim drops out. New RPC `session.owners {project_id}` and CLI `troop owners [path]` printing path, owner title and id, state |
| G4 | **Warn before an edit.** In `event.ts`, on `claude.PreToolUse` for Edit, Write or MultiEdit: when `owners` lists the `file_path` under another session that is not `exited`, print `hookSpecificOutput.additionalContext`: "`<path>` has uncommitted changes from session `<title>` (`<id>`), state `<state>`. Edit only your own lines; do not reformat or revert the file." Never blocks. Must stay inside the hook's 240 ms budget; the lookup reads the latest claim per path from an index on `event (kind, seq)` |
| G5 | **Overlap notice.** When a new claim names a path another live session also claims, append a `notice` comment to both sessions naming the other session and the paths. Schema v3 adds `'notice'` to `comment.kind` |
| G6 | **Left behind.** When a session reaches `exited` or `SessionEnd` while it still owns uncommitted paths, add a Needs you row "`<title>` left N files uncommitted" with one action, Open Git tab. In `workbench/src/gitpane.ts`, uncommitted files are grouped by owner (title and state), with "Stage this group". A shared file sits in its own group marked "shared, stage by hand" and is never in a group's stage action |
| G7 | **Hand back to the parent.** `session.parent_id TEXT REFERENCES session(id)` in schema v3. `troop launch` reads its own `process.env.TROOP_SESSION_ID` (set when run from inside a session's shell) and passes it as `parent_id` in the `session.launch` params; `launch.ts` stores it. When the child ends, the core writes one `notice` comment to the parent: child title, owned paths and whether each is committed, the child's `last_line`, and the transcript path. Delivered once, by G-D4 |

Not in this child: hunk-level ownership (G-D5); Codex and agy external adoption (G-D7); auto-committing
anything. Upgrade path for hunks if a shared file turns out common: per-turn `git diff -U0 <turn_base>`
ranges stored in the claim, matched like M4-10 I1.

## Acceptance criteria

- M4-26. Session A changes a file only through Bash (`sed -i`). After A's `Stop`, `troop owners` lists that
  file under A.
- M4-27. A Claude session started with no `TROOP_SESSION_ID` in a registered project appears in
  `troop sessions` with host `external` within 2 s of its first hook event, and its edits are claimed.
- M4-28. Session B's `PreToolUse` for Edit on a file A owns, with A `working`, prints `additionalContext`
  naming A. The same edit on an unclaimed file prints nothing. With 10,000 events in the store the hook
  exits within 240 ms.
- M4-29. A and B both change `x.ts` in overlapping turns with no hook hint: `troop owners` shows `x.ts`
  as `shared`, both sessions receive one `notice` on their next prompt, and the Git tab shows `x.ts` in
  the shared group, outside every "Stage this group" action.
- M4-30. A exits owning 2 uncommitted files: Needs you shows "A left 2 files uncommitted", and the Git
  tab groups them under A. After they are committed, the row clears on the next refresh.
- M4-31. Session P runs `troop launch claude --prompt ...`; the child C edits one file and ends. P's next
  `UserPromptSubmit` receives exactly one notice naming C and that file; the one after receives none.
- M4-32. An untracked file that existed before session A's turn is not claimed by A at `Stop`; one A
  creates during the turn is.

## Tests

| Criterion | Test | Kind |
|---|---|---|
| M4-26, M4-29, M4-32 | `core/test/session-owners.test.ts` (temp git repo, two fake sessions driving `event.ts`) | integration |
| M4-27 | `core/test/sessions-and-hooks.test.ts` new case | integration |
| M4-28 | `core/test/session-owners.test.ts` hook timing case | integration |
| M4-30 | `workbench/test/gitpane.test.ts` new case, `workbench/test/queries.test.ts` new case | unit |
| M4-31 | `core/test/sessions-and-hooks.test.ts` new case | integration |

Tests by Codex. Size: about 2 CC days. Depends on nothing open in Milestone 4.
