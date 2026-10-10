# Workbench

Windows and Linux (beta). Local only: no account, no telemetry.

The Electron window over the core. It draws from direct reads of `~/.metatrooper/troop.db` and sends every
change as a pipe command; it decides nothing itself.

## Run

```
cd workbench
npm install
npm run dev
```

Start the core first (`node core/cli.ts serve`), or leave it off to see the "core offline" badge; commands
sent while it is down are queued and run when it starts.

## How it is built

- `src/main.ts`: the main process. One read-only connection to `troop.db`; a folder watcher on
  `~/.metatrooper/` filtered to `troop.db*` with a 50 ms debounce, plus a 1 s `PRAGMA data_version` and
  heartbeat poll, push a fresh snapshot to the window. Pipe calls go through the core's own client
  (`core/src/pipe/client.ts`) with `ui.hello`, limited to the methods in `UI_METHODS`.
- `src/queries.ts`: every read the window needs, as one snapshot.
- `src/preload.cjs`: the only bridge the page gets (`window.troop`).
- `renderer/`: plain HTML, CSS and JS; no framework and no network (the page's CSP and a request filter in
  the main process allow only the app's own files).

## Test hooks

| Variable | Effect |
|---|---|
| `METATROOPER_WORKBENCH_PROBE` | a file; each render appends the visible session states and the online flag |
| `METATROOPER_LONGTASK_LOG` | a file; the renderer's long-task observer appends every main-thread task over 50 ms |

`npm test` runs the query tests and, when the Electron binary and a display (or `xvfb-run`) exist, the M1-11
end-to-end test. `node workbench/scripts/longtask-session.ts --minutes 10` is the M1-07 run: three sessions,
an event every 250 ms, two core kills and restarts; it exits 1 if any task passed 50 ms.
