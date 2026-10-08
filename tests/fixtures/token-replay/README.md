# token-replay fixture

`repo/` is `axios/axios` at tag `v1.7.2` (commit `0e4f9fa`, MIT, licence in `repo/LICENSE`): `lib/`,
`index.js` and `package.json`, 65 files, about 5,000 lines. The harness copies it to a temp folder, commits it
once there and applies one patch.

| Patch | Files | Changed lines |
|---|---|---|
| `small.patch` | 1 | 12 |
| `medium.patch` | 4 | 26 |
| `large.patch` | 16 | 314 |

`baseline.json` holds the `before` sizes from `node tests/replay/token-replay.mjs --diff <name> --mode before`.
`real-before.json` and `real-after.json` hold the real-run meter totals from `tests/replay/REAL-RUNS.md`.
