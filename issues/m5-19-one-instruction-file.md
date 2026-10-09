# M5-19 One instruction file for every engine

Child of Milestone 5 in `spec.md`. Tag: BLOCKER (ships 2026-12-01). Effort 0.5 CC days. Added 2026-10-09 after Gemini named it as a
missing call: the most-asked-for capability in the demand scan is one instruction file for every agent
(claude-code #6235, 6,685 reactions; `ide-layer-research/m5-demand.md`).

## Current state

Codex reads `AGENTS.md` natively. Claude Code reads `CLAUDE.md`. Gemini reads `GEMINI.md` unless its settings name
another context file. A project with only `AGENTS.md` gives Claude and Gemini no instructions.

## What to build

MetaTrooper never writes into the user's project for this. Per session, at launch:

- claude: when the project has `AGENTS.md` and no `CLAUDE.md`, add the engine's own flag for an extra system-prompt
  file pointing at `AGENTS.md`. First verify the flag name and behaviour on the installed Claude Code version and
  record it here; if no such flag exists, show a one-line tip on the tile ("add `@AGENTS.md` to CLAUDE.md") and
  build nothing.
- agy: same check for a per-launch context-file option; tip if none.
- codex: nothing to do.
- Project bar shows which instruction files each engine will read.

## Acceptance criteria

- M5-19a. In a fixture project with only `AGENTS.md`, a claude session's argv carries the verified flag pointing at
  that file, and the project folder is byte-identical after the session.
- M5-19b. With both files present, no flag is added.

## Verified 2026-10-09

- Claude Code 2.1.295 has `--append-system-prompt-file <path>`. A `claude -p` run in a folder holding only an
  `AGENTS.md` with a codeword, launched with `--append-system-prompt-file AGENTS.md`, answered with the codeword.
- agy 1.x has no context-file flag, but it reads `AGENTS.md` on its own: the same codeword test with no flag and
  "do not read any files" answered with the codeword. No tip needed.
- Built: the engine registry field `agents_md` (`unless` files, `args`); claude adds
  `--append-system-prompt-file AGENTS.md` (relative, so it also works on the sandbox host) when the session folder has
  `AGENTS.md` and neither `CLAUDE.md` nor `.claude/CLAUDE.md`. Codex and agy need nothing.
- Not built yet: the project bar line showing which files each engine reads. It is a screen change and waits for
  Wasif's look on screen.
