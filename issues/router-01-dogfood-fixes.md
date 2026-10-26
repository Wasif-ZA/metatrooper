# ROUTER-01: Fix what four weeks of dogfooding showed, so recipes get picked and stop failing

Part of metarouter (`router/`). Priority: Medium. Effort: about 1.5 CC days. Depends on: none.
**Start on or after 2026-11-08.** Own projects are frozen until then; do not build before.

## Context

Data: `~/.metarouter/calls.jsonl`, 19,941 calls, 2026-09-28 to 2026-10-26, about 230 sessions.

| Measure | Value |
|---|---|
| `exec` calls (every Bash call, wrapped by `metarouter.hook`) | 19,518 (98%) |
| Calls that named metarouter directly (`stats --adoption`) | 539 of 27,286 shell calls (2%) |
| `run` calls (recipes) | 407 |
| Recipes ever run | 50 of 83 |
| `exec` output kept out of context | 29.3 MB of 48.1 MB (61%) |
| Hints waiting in `learn --review` | 56 |

`exec` works without anyone choosing it. Recipes mostly go unused, and three of the most-used ones fail often.

## Work

### 1. The hook names the recipe when an agent writes inline python for a recipe's job

`stats --adoption` already classifies these shapes:

| Shape | Count | Recipe |
|---|---|---|
| inline python: json read | 463 | `json` |
| inline python: image | 360 | `img` |
| inline python: file edit | 303 | `replace` |
| inline python: json read and write | 234 | `json-set` |
| inline python: regex search | 104 | `find` |

In `metarouter/hook.py` `wrap_bash`, run the same shape classifier. On a match, still run the command, and add one
hint line naming the recipe and its usage. Do not rewrite the command into a recipe; argument mapping from free python
is guesswork. Reuse the existing hint mechanism so `stats` counts these hints and whether they are followed.

### 2. `run` accepts `--no-trunc` for every recipe

`page`: 14 of 67 runs failed, 13 with exit 2, all with `--no-trunc`. The recipe's argparse
(`metarouter/recipes/web.py:153`) does not know the flag, and `exec`'s own note ("shrunk; --no-trunc for all") teaches
agents to add it. Strip `--no-trunc` in the `run` lane before recipe argparse sees it, and apply it to the output.
One place, all recipes.

### 3. `codex` recipe with `--prompt-file --write`

11 of 29 runs failed, every one exit 1 with `--prompt-file` and `--write` together. Reproduce, find the root cause, fix
it, and add one test for that flag pair.

### 4. `json` recipe paths

7 of 12 runs failed (exit 1) on dotted paths such as `columns.task_03.from` and on single keys like `notes`. Reproduce
against the real files from the logs, fix path parsing, and add one test per failing shape.

### 5. Exit 1 from a checker is not a failure

`python meta/scripts/page-check.py ... --widths N` ran 386 times: 279 exit 0, 104 exit 1. Exit 1 there means "found
render problems", which is the tool working. It is the top entry in `digest` top failures and inflates the 1,107
failure count. Let a recipe declare which exit codes mean "findings", and add a `page-check` recipe declaring
`findings: [1]`. `stats` and `digest` count findings apart from failures.

### 6. Prune and review

- 33 of 83 recipes never ran. Remove the `learned` ones with zero runs (for example `curl-head`, `npm-run-check`).
  Keep `seed` and `catalog` recipes.
- Clear the 56 hints in `metarouter learn --review` (with Wasif; he approves recipes).

### 7. Make every use cheaper than not using it (A/B, 2026-10-26)

`metarouter ab`, Claude, all runs passed in both arms:

| Task | Runs per arm | Cost per pass, A minus B |
|---|---|---|
| Find a line in a 5,000-line log | 3 | +$0.0094 (+4.8%) |
| Fix a planted bug, 2 of 458 router tests failing | 5 | +$0.0156 (+6.9%), one extra median turn |

Metarouter cost more on both. The kept-out bytes are real, but the 61% figure leaves out the fixed costs: the
instruction block on every turn, the JSON envelope, and extra turns (`search` first, `--no-trunc` reruns). Of the call
log's exec calls, 13,964 of 19,782 had under 2 KB of output, where shrinking saves nothing. 209 calls of 20 KB or more
supplied about 40% of all bytes kept out (12.3 MB of 31.9 MB).

- Below a size threshold, `exec` prints the raw output exactly as the shell would: no envelope, no log path, no note.
- Above it, print plain text, not JSON with escaped `\n`, and show the errors and tail without inviting a rerun.
- Cut the instruction block and the CLAUDE.md routing line to the minimum. The hook does the wrapping without the agent
  knowing; the block mainly buys `search` turns. A/B it with and without the block.
- Rerun `metarouter ab` on both tasks above, plus one with output of 20 KB or more. Bar: A costs no more than B on
  small tasks, and less on the large one.

Harness fix found on the way, still uncommitted in `router/`: `ab.py` `agent_env` sets `METAROUTER_HOOK=off` in arm B
(before it, the global hook wrapped both arms, so every earlier `ab` result compared metarouter with itself), plus one
assertion in `tests/test_ab.py`. Commit it first. Two planted bugs in `shrink.py` (`clip` off-by-one, `errors` cap)
passed all 458 tests; add tests for both. Reports: `~/.metarouter/ab/20261026T115430.json`, `20261026T123930.json`.

## Acceptance

- [ ] An inline-python json read through the hook prints a hint naming `metarouter run json`.
- [ ] `metarouter run page <url> --no-trunc` exits 0.
- [ ] `metarouter run codex --prompt-file f --write` passes its new test.
- [ ] `metarouter run json <file> columns.task_03.from` returns the value; test added.
- [ ] `metarouter digest` no longer lists `page-check` exit 1 as a failure.
- [ ] `metarouter list` has no `learned` recipe with zero runs.
- [ ] Two weeks after shipping, rerun `metarouter stats --adoption`: recipe share above 2%, and the five inline-python
      shapes are lower than the table above, scaled to the same number of days.
