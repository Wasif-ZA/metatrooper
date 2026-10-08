# Real before-runs and after-runs (M4-1, M4-04)

Done by Wasif with real engines. Run them once before any M4-3 change (`real-before.json`) and once after M4-3,
M4-9 and M4-10 land (`real-after.json`). Same fixture, same inputs both times.

## 1. two-engine-review on the large patch

```
node tests/replay/token-replay.mjs --diff large --mode before   # sanity check, prints the baseline size
```

1. Copy `tests/fixtures/token-replay/repo` to a scratch folder, `git init`, commit everything, then
   `git apply <metatrooper>/tests/fixtures/token-replay/large.patch`. Do not commit the patch.
2. `troop run start two-engine-review --project <scratch folder>` and let it finish.
3. Note the run id.

## 2. spec-to-pr, stopped before anything is pushed

1. Make an empty scratch GitHub repo with one commit on `main`.
2. `troop run start spec-to-pr --project <its clone> --input idea="add a /health route that returns ok"`.
3. Approve the spec gate. At `approve-pr`, press **Reject**. Nothing is pushed.
4. Note the run id.

## 3. Record

For each run, read the per-step token totals (Claude plus Codex, from the `usage` table) and write:

```json
{
  "commit": "<metatrooper commit hash the runs used>",
  "runs": {
    "two-engine-review": { "run_id": "<id>", "steps": { "codex-review": 0, "gemini-review": 0 }, "total": 0 },
    "spec-to-pr": { "run_id": "<id>", "steps": { "spec": 0, "build": 0 }, "total": 0 }
  }
}
```

to `tests/fixtures/token-replay/real-before.json` (or `real-after.json`). agy steps record 0: agy reports no
usage (M1-28).
