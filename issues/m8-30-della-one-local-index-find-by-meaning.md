# M8-30: Della: one local index, find by meaning

Part of Ouros, Milestone 8. Priority: Medium. Effort: not sized (sized after M8-0). Depends on: M8-1.
Status in scratch: verdict pending (Della boards).
**Start on or after 2026-11-09.**

## Source of truth

- `spec.md` Milestone 8 row M8-30; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): ~/.cache/claude-scratch/ouros-explorer-2026-10-30/round-1/board.json, round-2/board2.py call C3; projects/operators/della-file-explorer/START-HERE.md.

## What was designed

- One local index in node:sqlite holds text and vectors keyed by content hash, so a moved file is never re-embedded.
- Search merges FTS5 and vector hits with RRF, k=60. Embeddings come from Ollama /api/embed on 127.0.0.1.
- Name search works at once; meaning search improves per folder as indexing finishes. The user picks which folders Della may read; code folders are left to Ouros.
- Every hit shows the matched text as evidence plus its path. `?` prefix in Ouros, plain descriptions in the standalone window.
- Open call C3: exact cosine in a BLOB column, or sqlite-vec (8.2k stars, below the dependency gate).

## Blocked on

- Della calls C3 and whether Della ships inside Milestone 8.

## Acceptance criteria

- [ ] M8-30a. A new folder answers a name search before its embeddings finish, and says meaning search is still indexing.
- [ ] M8-30b. Moving a file makes zero embed calls.
- [ ] M8-30c. "brochure with the blue cover" returns the brochure with the matched snippet.
- [ ] M8-30d. With Ollama stopped, name search works and meaning search says it is unavailable.
- [ ] M8-30e. A test shows no request leaves 127.0.0.1.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
