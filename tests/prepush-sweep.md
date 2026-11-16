# Pre-push sweep

Run with Node 24 and Git from the repository worktree:

```sh
node tests/prepush-sweep.mjs
node tests/prepush-sweep.mjs --base origin/main --head HEAD --json
```

The default range is `origin/main..HEAD`. The sweep reports outside product and
ACU references in commit messages and author/committer identities, secrets and
personal paths in added lines of every commit, blobs over 5 MiB (including files
deleted later), committed junk paths, and a base that is not an ancestor of head.
It also warns about untracked junk with `untracked, keep out of the commit`.
Placeholder user paths are allowed. Secret values are masked to their first four
characters. Findings are deduplicated by `(check, file, masked match)` across the
range, including repeated lines and merge-parent patches. Each finding includes
the number of distinct commits and the newest short commit SHA in Git log order.
Findings without a commit (for example untracked files) have a commit count of 0.
The final table groups unique findings by check with `fail`, `warn`, and `allowed`
counts. JSON output includes the same totals in `groupedCounts`, aggregate
`failures`, `warnings`, and `allowed`, plus structured findings with `commitCount`.
The `counts` object contains total unique findings per check, including allowed ones.

Ambiguous product names `Cursor`, `Warp`, `Zed`, `Conductor`, and `Superset`
match only capitalised whole words. `t3code`, `t3 code`, `Paperclip`, `herdr`, and
`conductor.build` match case-insensitively. Only repository-root `dist/` is junk;
tracked build output under `core/dist/` is allowed by the junk-folder check.

Exceptions live in [prepush-sweep-allow.json](prepush-sweep-allow.json), an array
of entries with exactly these fields:

```json
{ "check": "personal-paths", "path": "core/test/*.ts", "reason": "Test fixture paths." }
```

Paths are case-sensitive, repository-relative POSIX globs (`*` for one segment,
`**` for multiple segments), matched against the entire path. Both check and path
must match. Every allowed finding remains visible with severity `allowed` and its
reason; it does not fail the run. Invalid entries produce exit code 2.

The seeded exceptions cover fake secrets in `core/test/redact-wide.test.ts`,
fixture paths in that file and `core/test/packaged-node-hooks.test.ts`, and generic
secret key/value assignments in `workbench/renderer/ui.bundle.js`. The bundle
exception is restricted in code to the generic `password|secret|token|api_key`
assignment pattern: specific token patterns such as `ghp_`, `sk-`, and `AKIA`
still fail there. If generic and specific patterns produce the same masked match,
the failure takes precedence. There are no exceptions for `issues/` or `router/tests`.

Exit codes: **0** means no failures (warnings and allowed findings do not fail),
**1** means at least one failing finding, and **2** means a usage, allowlist, or Git error.

This is a read-only report. It never pushes, fetches, commits, rewrites, or deletes
anything. It does not scan uncommitted file contents or replace a full secret audit.

Run the regression checks without spawning Git or test worker processes:

```sh
node --test --test-isolation=none tests/prepush-sweep.test.mjs
```
