# metarouter A/B Evaluation Benchmark

This benchmark evaluates coding agents with and without `metarouter` on standard coding and navigation tasks.

## Arms

- **plain**: The agent is provided only with the task description (`task.md`).
- **metarouter**: The README's four-line instruction block is prepended to the task, with an empty
  `METAROUTER_HOME`: a fresh install.
- **metarouter-memory**: Same prompt, run twice on the same task with one `METAROUTER_HOME`. Only
  the second session is scored, so recipes saved in the first can be reused. This is the arm that
  tests tool memory; it costs two Codex sessions per run.

Every arm gets its own Codex home holding only `auth.json` and `config.toml`, so a personal
`AGENTS.md` never reaches the prompt. Runs use `--repeats 3` by default.

On Windows, Codex's sandbox cannot run this harness: the elevated sandbox writes files the checker
cannot read, and the unelevated one cannot open the task folder. Run it on Linux or macOS (WSL works).

## What It Measures

- **Correctness**: Each task includes a deterministic `check.py` that verifies the solution without network dependencies.
- **Token Usage**: Input (uncached and cached), output, total, and tokens per passed task, from Codex JSONL events.
- **Duration**: Wall-clock execution time for each run.

## Tasks

1. `find-config`: Locate which configuration file in a tree of 30 files sets `timeout = 45`.
2. `fix-json`: Repair invalid JSON syntax (trailing comma) and update a setting value.
3. `failing-test`: Fix an off-by-one bug in a Python function to pass pytest without modifying the test suite.
4. `log-needle`: Locate a specific error line in a 5,000-line server log file.
5. `rename-symbol`: Rename a function symbol across four Python files in a package.
6. `summarise-diff`: Identify files with uncommitted git modifications in a repository.

## How to Run

Test check scripts against unsolved setups (verify non-vacuity):
```bash
python bench/ab/run_ab.py --self-test
```

Preview prompts and folders without executing Codex:
```bash
python bench/ab/run_ab.py --dry-run
```

Run full evaluation across all tasks and arms:
```bash
python bench/ab/run_ab.py
```

Run a subset of tasks or arms:
```bash
python bench/ab/run_ab.py --tasks find-config,fix-json --arms plain,metarouter
```

Output results to a custom file:
```bash
python bench/ab/run_ab.py --out bench/ab/results.jsonl
```

## Cost Note

Running the full benchmark executes model calls via `codex exec`, which consumes LLM tokens and may incur API costs. Use `--dry-run` or `--self-test` to inspect setups and verify harness logic without making model calls.
