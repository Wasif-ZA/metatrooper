# M6-4: Core reliability: lock order, settings writer, migrations, ping, restart owner

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical. Effort: 2.0 CC days. Depends on: none.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-4, and every section that names M6-4.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Acceptance criteria

- [ ] M6-04a. Starting a second core while one runs exits with "core already running (pid N)" before it opens `troop.db` (the database file's mtime is unchanged and a fixture command left `accepted` runs exactly once).
- [ ] M6-04b. A `settings.json` holding invalid JSON is left byte-identical after the workbench changes a setting, and the workbench shows "settings.json does not parse, line N". A valid change writes the new value; killing the core between the temp write and the rename leaves the old file valid and the next start removes the temp file.
- [ ] M6-04c. A database at the M5 schema opens under the new code, applies its numbered migrations once, and opens again with no change.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests where spec.md D65 lists this child.
- No em dashes; comments say what the code does, not why.
