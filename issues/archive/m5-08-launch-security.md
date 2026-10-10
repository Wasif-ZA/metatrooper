# M5-8 Launch security subset

Child of Milestone 5 in `spec.md`. Tag: BLOCKER (ships 2026-12-01). Effort 1.0 CC days (S1 to S4; S5 is M4-4 on m4-harden). Codex writes the tests; Codex plus Gemini review
the diff. Taken from the 2026-10-09 harden plan (P0 list); the sandbox P0s are M5 work after 12-01 because the sandbox ships
behind an experimental flag (M5-D5).

## What to build

| # | Item | Evidence | Fix | CC days |
|---|---|---|---|---|
| S1 | Schema rebuild can drop data | `core/src/store/db.ts:46` `rebuildTable` copies only `schema.sql` columns (called at `:67`, `:85`) | keep unknown columns: copy every column the old table has that the new one also has, and refuse to start (with a message naming the column) when an old column holding data would be lost | 0.25 |
| S2 | Browser pipe ACL untested | `workbench/src/browser/server.ts` uses the same default DACL as the core pipe; `core/test/pipe-acl.test.ts` covers only core and `-term` | add the browser pipe to the DACL test in an Electron run; Wasif runs `tests/windows/m1-10-pipe-acl.ps1` as a second standard user (M1-10) | 0.25 |
| S3 | `shell: true` fallback | `core/src/hook/launch.ts:43-46`: an unresolved command runs through cmd with hand-rolled quoting (`%VAR%` expands inside quotes, the command name is unquoted); runs for every session | refuse: an unresolved command fails the launch with "could not find <command> on PATH" | 0.25 |
| S4 | safe-fetch light review | `plugins/*/bin/safe-fetch.js` ships in four plugins; one SSRF found by hand (64d06ea) | targeted Codex and Gemini review of the file; fix what both find | 0.25 |
| S5 | Secret scan before an external send (built on m4-harden as M4-4, 2026-10-09; not rebuilt here) | M4-4 half M4-20 (`issues/m4-04-secret-scan.md`) not started; Pro sends every diff to OpenAI and Google | build the `scan` and `send-check` steps of M4-4 for `two-engine-review` and `pr-review-fix`; the publish-gate half stays AFTER | 1.0 |

## Acceptance criteria

- M5-08a. A `troop.db` whose `session` table has an extra column with data survives a core start with the column
  and data intact.
- M5-08b. The browser pipe DACL grants only the owner, SYSTEM and Administrators.
- M5-08c. Launching an engine whose command does not resolve returns the "could not find" error and spawns no cmd.
- M5-08d. M4-20 passes (in `issues/m4-04-secret-scan.md`).
