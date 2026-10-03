# Toolrouter A/B Evaluation Benchmark

This benchmark evaluates coding agents with and without `toolrouter` on standard coding and navigation tasks.

## Arms

- **plain**: The agent is provided only with the task description (`task.md`).
- **toolrouter**: The agent is provided with `toolrouter` usage instructions prepended to the task description.

## What It Measures

- **Correctness**: Each task includes a deterministic `check.py` that verifies the solution without network dependencies.
- **Token Usage**: Measures input, output, and total token usage extracted from Codex JSONL execution events.
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
python bench/ab/run_ab.py --tasks find-config,fix-json --arms plain,toolrouter
```

Output results to a custom file:
```bash
python bench/ab/run_ab.py --out bench/ab/results.jsonl
```

## Cost Note

Running the full benchmark executes model calls via `codex exec`, which consumes LLM tokens and may incur API costs. Use `--dry-run` or `--self-test` to inspect setups and verify harness logic without making model calls.
