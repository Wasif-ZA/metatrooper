# M6-1 split inventory

Every hit of the spec's search on the tree before the split (`main` at 3143c9c, tag `pipelines-final`), one row
each, marked move, remove, replace or keep. Generated from the before and after trees, so a row's mark is what the
code now holds, not a plan.

```
rg -n "Runner|runner\.|pipelines/|schedules|gate\.resolve|run\.(start|cancel|resume|clear|status)|variant|template\.list|rundetail|boardCapture|pipeline" core/src core/cli.ts workbench/src workbench/renderer
```

Totals: keep 13, move 207, remove 186, replace 2; 408 rows.
Re-running the search after the split returns 17 hits: the keep rows below, plus 4 new lines
that name the moved methods (last table). Every hit is closed.

| Hit | Text | Mark | Why |
|---|---|---|---|
| core/cli.ts:32 | `run start <pipeline> [--project <path>] [--input key=value]...` | remove | `troop run` and its help lines removed; `troop gate` (adoption measurement) stays |
| core/cli.ts:33 | `start a pipeline run; prints the run id` | remove | `troop run` and its help lines removed; `troop gate` (adoption measurement) stays |
| core/cli.ts:37 | `run cancel <run>              cancel a run and its sub-pipeline runs` | remove | `troop run` and its help lines removed; `troop gate` (adoption measurement) stays |
| core/cli.ts:374 | `const r = await rpc('run.start', { pipeline_id: target, project_id: project.id, inputs, trigger: 'cli' }, j...` | remove | `troop run` and its help lines removed; `troop gate` (adoption measurement) stays |
| core/cli.ts:379 | `const r = await rpc('run.cancel', { run_id: target }, json);` | remove | `troop run` and its help lines removed; `troop gate` (adoption measurement) stays |
| core/cli.ts:390 | `const r = await rpc('run.clear', project_id ? { project_id } : {}, json);` | remove | `troop run` and its help lines removed; `troop gate` (adoption measurement) stays |
| core/cli.ts:410 | `console.error('usage: troop run start <pipeline> [--project <path>] [--input k=v] \| wait <run> [--timeout ...` | remove | `troop run` and its help lines removed; `troop gate` (adoption measurement) stays |
| core/src/methods.ts:19 | `import { cronMatches } from './schedules.ts';` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:24 | `import type { Runner } from './pipelines/runner.ts';` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:25 | `import { listTemplates, syncPipelines, validationContext } from './pipelines/store.ts';` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:26 | `import { validatePipeline } from './pipelines/validate.ts';` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:31 | `import { setItemStatus } from './pipelines/panes.ts';` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:45 | `runner: Runner;` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:295 | `'INSERT INTO schedule (id, pipeline_id, project_id, cron, inputs, enabled) VALUES (?, ?, ?, ?, ?, ?)` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:297 | `).run(id, str(p, 'pipeline_id'), str(p, 'project_id'), cron, JSON.stringify(p.inputs ?? {}), p.enabled === ...` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:326 | `m.set('gate.resolve', {` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:341 | `if (decision === 'approve' && gate.kind === 'handoff') ctl.runner.checkContinue(gate.run_id, gate.step_id);` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:399 | `m.set('template.list', { handler: () => ({ templates: listTemplates(db) }) });` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:401 | `m.set('pipeline.validate', {` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:416 | `m.set('run.start', {` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:422 | `const run_id = ctl.runner.start({` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:423 | `pipeline_id: str(p, 'pipeline_id'), project_id: str(p, 'project_id'), inputs: inputs as Record<string, unkn...` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:429 | `m.set('run.cancel', { handler: (p) => { ctl.runner.cancel(str(p, 'run_id')); return {}; } });` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:431 | `m.set('run.clear', {` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:452 | `m.set('run.resume', {` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:456 | `ctl.runner.resume(str(p, 'run_id'), raise);` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:461 | `m.set('variant.pick', { handler: (p) => { ctl.runner.pick(str(p, 'run_id'), int(p, 'idx')); return {}; } });` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:462 | `m.set('variant.discard', { handler: (p) => { ctl.runner.discard(str(p, 'run_id'), int(p, 'idx')); return {}...` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:560 | `m.set('variant.combine', {` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:564 | `throw new RpcError(E.INVALID_PARAMS, 'indices must be a list of variant indices');` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| core/src/methods.ts:566 | `return ctl.runner.combine(str(p, 'run_id'), indices as number[], typeof p.note === 'string' ? p.note : '');` | remove | pipeline methods, `schedule.set`, `gate.resolve`, board methods and their imports removed; `runner` dropped from `CoreControl` |
| workbench/renderer/wall.css:28 | `html, body { width: 100%; height: 100%; overflow: hidden; background: var(--canvas-deep); color: var(--ink)...` | keep | `font-variant-numeric` is CSS, not a pipeline variant |
| workbench/src/main.ts:25 | `import { paneData } from '../../core/src/pipelines/panes.ts';` | remove | run, pipeline and variant IPC handlers and the `paneData` import removed; hand-back reads the project only |
| workbench/src/main.ts:26 | `import { runDetail, runShot } from './rundetail.ts';` | remove | run, pipeline and variant IPC handlers and the `paneData` import removed; hand-back reads the project only |
| workbench/src/main.ts:38 | `'run.start', 'run.cancel', 'run.clear','run.resume', 'gate.resolve', 'pipeline.validate', 'template.list', ...` | remove | run, pipeline and variant IPC handlers and the `paneData` import removed; hand-back reads the project only |
| workbench/src/main.ts:62 | `return { at: Date.now(), core: { online: false, pid: null, heartbeat_age_ms: null }, projects: [], engines:...` | remove | run, pipeline and variant IPC handlers and the `paneData` import removed; hand-back reads the project only |
| workbench/src/main.ts:244 | `const row = d && typeof id === 'string' ? (d.prepare('SELECT path FROM pipeline WHERE id = ?').get(id) as {...` | remove | run, pipeline and variant IPC handlers and the `paneData` import removed; hand-back reads the project only |
| workbench/src/main.ts:263 | `if (typeof json.id !== 'string' \|\| !/^[a-z0-9][a-z0-9-]{1,62}$/.test(json.id)) return { ok: false, error:...` | remove | run, pipeline and variant IPC handlers and the `paneData` import removed; hand-back reads the project only |
| workbench/src/main.ts:264 | `const builtin = path.resolve(here, '..', '..', 'pipelines', '${json.id}.json');` | remove | run, pipeline and variant IPC handlers and the `paneData` import removed; hand-back reads the project only |
| workbench/src/main.ts:265 | `const shipped = fs.existsSync(builtin) ? { path: builtin } : (d.prepare("SELECT path FROM pipeline WHERE id...` | remove | run, pipeline and variant IPC handlers and the `paneData` import removed; hand-back reads the project only |
| workbench/src/main.ts:269 | `fs.rmSync(path.join(project.path, '.troop', 'pipelines', '${json.id}.json'), { force: true });` | remove | run, pipeline and variant IPC handlers and the `paneData` import removed; hand-back reads the project only |
| workbench/src/main.ts:274 | `const dir = path.join(project.path, '.troop', 'pipelines');` | remove | run, pipeline and variant IPC handlers and the `paneData` import removed; hand-back reads the project only |
| workbench/src/main.ts:276 | `if (!inside(dir, file)) return { ok: false, error: 'bad pipeline id' };` | remove | run, pipeline and variant IPC handlers and the `paneData` import removed; hand-back reads the project only |
| workbench/src/main.ts:396 | `? (d.prepare("SELECT v.idx, v.worktree, v.branch FROM variant v JOIN run r ON r.id = v.run_id WHERE v.run_i...` | remove | run, pipeline and variant IPC handlers and the `paneData` import removed; hand-back reads the project only |
| workbench/src/main.ts:401 | `return { ...handback(gitIn(picked.worktree), { base, cwd: picked.worktree }), variant: picked.idx, branch: ...` | remove | run, pipeline and variant IPC handlers and the `paneData` import removed; hand-back reads the project only |
| workbench/src/main.ts:415 | `? (d.prepare("SELECT v.worktree, v.branch FROM variant v JOIN run r ON r.id = v.run_id WHERE v.run_id = ? A...` | remove | run, pipeline and variant IPC handlers and the `paneData` import removed; hand-back reads the project only |
| workbench/renderer/index.html:30 | `<footer id="strip" class="strip"><span id="strip-needs"></span><span id="strip-info" class="task"></span><b...` | remove | run layout scripts and styles, the run box and the Runs and Pipelines strip buttons removed |
| workbench/renderer/index.html:69 | `<script src="layouts/variants-grid.js"></script>` | remove | run layout scripts and styles, the run box and the Runs and Pipelines strip buttons removed |
| workbench/src/rundetail.ts:4 | `import { paneFile } from '../../core/src/pipelines/panes.ts';` | move | file left for `../suite-of-products/shared/workbench/src/rundetail.ts` |
| workbench/src/rundetail.ts:5 | `import { assistRegistry, type AssistResult } from '../../core/src/pipelines/assists.ts';` | move | file left for `../suite-of-products/shared/workbench/src/rundetail.ts` |
| workbench/src/rundetail.ts:30 | `/** One entry per helper the run's pipeline lists, with what '<run_dir>/assists.json' found. */` | move | file left for `../suite-of-products/shared/workbench/src/rundetail.ts` |
| workbench/src/rundetail.ts:33 | `const pipe = JSON.parse(fs.readFileSync(path.join(runDir, 'pipeline.json'), 'utf8')) as { assists?: Array<{...` | move | file left for `../suite-of-products/shared/workbench/src/rundetail.ts` |
| core/src/schedules.ts:40 | `* Checks schedules; fires those due this minute. A fire time that passed while the core was down is recorded` | move | file left for `../suite-of-products/shared/core/src/schedules.ts` |
| core/src/schedules.ts:43 | `export function tickSchedules(db: DatabaseSync, startRun: (pipelineId: string, projectId: string, inputs: u...` | move | file left for `../suite-of-products/shared/core/src/schedules.ts` |
| core/src/schedules.ts:45 | `.prepare('SELECT id, pipeline_id, project_id, cron, inputs, last_fired FROM schedule WHERE enabled = 1')` | move | file left for `../suite-of-products/shared/core/src/schedules.ts` |
| core/src/schedules.ts:46 | `.all() as Array<{ id: string; pipeline_id: string; project_id: string; cron: string; inputs: string; last_f...` | move | file left for `../suite-of-products/shared/core/src/schedules.ts` |
| core/src/schedules.ts:59 | `.run(ulid(), nowIso(), 'missed-schedule', s.id, 'Schedule for ${s.pipeline_id} was due at ${nowIso(t)} whil...` | move | file left for `../suite-of-products/shared/core/src/schedules.ts` |
| core/src/schedules.ts:66 | `startRun(s.pipeline_id, s.project_id, JSON.parse(s.inputs \|\| '{}'));` | move | file left for `../suite-of-products/shared/core/src/schedules.ts` |
| core/src/main.ts:11 | `import { CommandRunner } from './pipe/commands.ts';` | keep | `CommandRunner` is the pipe command queue, not the pipeline runner |
| core/src/main.ts:18 | `import { tickSchedules } from './schedules.ts';` | remove | runner, pipeline sync, board and pane capture hooks and the schedule timer removed |
| core/src/main.ts:22 | `import { Runner } from './pipelines/runner.ts';` | remove | runner, pipeline sync, board and pane capture hooks and the schedule timer removed |
| core/src/main.ts:24 | `import { syncBuiltinPlugins, syncPipelines } from './pipelines/store.ts';` | replace | `syncBuiltinPlugins` moved to `core/src/plugins/store.ts`; `syncPipelines` left with the runner |
| core/src/main.ts:56 | `const runner = new Runner(db);` | remove | runner, pipeline sync, board and pane capture hooks and the schedule timer removed |
| core/src/main.ts:69 | `try { runner.shutdown(); } catch {}` | remove | runner, pipeline sync, board and pane capture hooks and the schedule timer removed |
| core/src/main.ts:76 | `runner.setBoardCapture((req) => browserCall(uiKey, 'browser.board_capture', req, 60_000));` | remove | runner, pipeline sync, board and pane capture hooks and the schedule timer removed |
| core/src/main.ts:77 | `runner.setPaneCapture((pane_id, label) => browserCall(uiKey, 'browser.capture', { pane_id, label }, 60_000)...` | remove | runner, pipeline sync, board and pane capture hooks and the schedule timer removed |
| core/src/main.ts:79 | `const commands = new CommandRunner(db, methods);` | keep | `CommandRunner` is the pipe command queue, not the pipeline runner |
| core/src/main.ts:86 | `runner.recover();` | remove | runner, pipeline sync, board and pane capture hooks and the schedule timer removed |
| core/src/main.ts:105 | `every(500, () => runner.tick());` | remove | runner, pipeline sync, board and pane capture hooks and the schedule timer removed |
| core/src/main.ts:118 | `every(30_000, () => tickSchedules(db, (pipelineId, projectId, inputs) => {` | remove | runner, pipeline sync, board and pane capture hooks and the schedule timer removed |
| core/src/main.ts:120 | `runner.start({ pipeline_id: pipelineId, project_id: projectId, inputs: (inputs ?? {}) as Record<string, unk...` | remove | runner, pipeline sync, board and pane capture hooks and the schedule timer removed |
| core/src/main.ts:123 | `.run(ulid(), nowIso(), pipelineId, 'Scheduled run of ${pipelineId} could not start: ${(e as Error).message}');` | remove | runner, pipeline sync, board and pane capture hooks and the schedule timer removed |
| workbench/src/queries.ts:14 | `pipelines: Array<{ id: string; title: string; source: string; path: string; valid: boolean; errors: string[...` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/src/queries.ts:15 | `runs: Array<{ id: string; pipeline_id: string; status: string; paused_why: string \| null; started_at: stri...` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/src/queries.ts:17 | `gates: Array<{ id: string; run_id: string; top_run: string; pipeline_id: string; step_id: string; guards_st...` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/src/queries.ts:20 | `live_runs: Array<{ id: string; project_id: string; pipeline_id: string; status: string; paused_why: string ...` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/src/queries.ts:21 | `panes: Array<{ id: string; url: string \| null; session_id: string \| null; run_id: string \| null; variant...` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/src/queries.ts:27 | `variants: Array<{ idx: number; status: string; branch: string; pane_id: string \| null; dev_port: number; s...` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/src/queries.ts:51 | `function pipelineFile(path: string, version: number, id: string): PipelineFile {` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/src/queries.ts:127 | `const pipelines = (db.prepare('SELECT id, source, path, version, valid, errors FROM pipeline ORDER BY id')....` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/src/queries.ts:129 | `...pipelineFile(String(r.path), Number(r.version), String(r.id)),` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/src/queries.ts:149 | `'SELECT id, pipeline_id, status, paused_why, started_at, ended_at, depth, parent_run FROM run` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/src/queries.ts:168 | `SELECT g.id, g.run_id, up.top AS top_run, r.pipeline_id, g.step_id, g.guards_step, g.kind, g.action_hash, g...` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/src/queries.ts:174 | `? (db.prepare('SELECT id, url, session_id, run_id, variant, dev_port FROM browser_pane WHERE project_id = ?...` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/src/queries.ts:190 | `const variants = runId` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/src/queries.ts:195 | `FROM variant v` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/src/queries.ts:198 | `).all(runId) as Snapshot['variants'])` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/src/queries.ts:209 | `pipelines,` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/src/queries.ts:215 | `live_runs: db.prepare("SELECT id, project_id, pipeline_id, status, paused_why, started_at FROM run WHERE pa...` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/src/queries.ts:219 | `variants,` | remove | pipelines, runs, steps, gates, live runs, board and variants dropped from the snapshot |
| workbench/renderer/panes.js:1 | `// Result panes for pipeline steps whose 'view' is items, document, table or findings.` | move | file left for `../suite-of-products/shared/workbench/renderer/panes.js` |
| workbench/src/browser/panes.ts:38 | `variant: number \| null;` | keep | `browser_pane.variant` and `run_id` columns stay in the schema with their rows (D58) |
| workbench/src/browser/panes.ts:127 | `UNION SELECT v.dev_port FROM variant v JOIN run r ON r.id = v.run_id WHERE r.project_id = ? AND v.dev_port ...` | remove | variant ports and `boardCapture` removed; until M6-3 agent panes reach no run-owned loopback port, which is safe |
| workbench/src/browser/panes.ts:781 | `async boardCapture(projectId: string, url: string, outFile: string): Promise<{ url: string; status: number ...` | remove | variant ports and `boardCapture` removed; until M6-3 agent panes reach no run-owned loopback port, which is safe |
| workbench/src/browser/panes.ts:783 | `await this.create({ id, project_id: projectId, run_id: null, variant: null, session_id: null, url: null, de...` | remove | variant ports and `boardCapture` removed; until M6-3 agent panes reach no run-owned loopback port, which is safe |
| workbench/src/browser/server.ts:29 | `AND bp.variant = (SELECT fanout_index FROM run_step WHERE session_id = ? LIMIT 1)))` | remove | run fan-out pane ownership, the `variant` field and `browser.board_capture` removed |
| workbench/src/browser/server.ts:80 | `return send({ jsonrpc: '2.0', id, result: rows.map((r) => ({ pane_id: r.id, url: r.url, variant: r.variant,...` | remove | run fan-out pane ownership, the `variant` field and `browser.board_capture` removed |
| workbench/src/browser/server.ts:100 | `return send({ jsonrpc: '2.0', id, result: await deps.panes.boardCapture(projectId, String(params.url ?? '')...` | remove | run fan-out pane ownership, the `variant` field and `browser.board_capture` removed |
| core/src/pipe/server.ts:5 | `import type { CommandRunner } from './commands.ts';` | keep | `CommandRunner` is the pipe command queue, not the pipeline runner |
| core/src/pipe/server.ts:24 | `export async function startPipeServer(pipePath: string, runner: CommandRunner, uiKey: string): Promise<net....` | keep | `CommandRunner` is the pipe command queue, not the pipeline runner |
| core/src/pipe/server.ts:46 | `const result = await runner.call(` | keep | `CommandRunner` is the pipe command queue, not the pipeline runner |
| core/src/plugins/mcp.ts:78 | `pipeline?: boolean;` | keep | the external-writes rule still guards any session launched with a run id; pipeline apps launch sessions through the pipe (D54) |
| core/src/plugins/mcp.ts:82 | `/** Whether a server may attach: an external-writes server never joins a pipeline step or a contained or is...` | keep | the external-writes rule still guards any session launched with a run id; pipeline apps launch sessions through the pipe (D54) |
| core/src/plugins/mcp.ts:85 | `if (writes === 'external' && (ctx.pipeline \|\| ctx.approval === 'contained' \|\| ctx.approval === 'isolate...` | keep | the external-writes rule still guards any session launched with a run id; pipeline apps launch sessions through the pipe (D54) |
| workbench/renderer/app.js:7 | `const KINDS = ['agent', 'action', 'pipeline', 'code', 'gate'];` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:13 | `tab: ['diff', 'git', 'handback', 'browser', 'runs', 'pipelines'].includes(load('tab')) ? load('tab') : 'diff',` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:24 | `pipelineId: null,` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:54 | `const p = ui.snap && ui.snap.pipelines.find((x) => x.id === id);` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:76 | `const ONE_AT_A_TIME = new Set(['session.launch', 'session.resume', 'run.start', 'run.resume', 'variant.comb...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:153 | `const THUMBS = new Set(['clips-to-scheduled-posts', 'data-to-dashboard', 'deep-research-cited', 'design-var...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:164 | `function pipelineCard(p) {` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:165 | `const last = ui.snap.runs.filter((r) => !r.parent_run && r.pipeline_id === p.id).sort((a, b) => (a.started_...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:167 | `return '<button class="pcard ${p.id === ui.pipelineId ? 'on' : ''} ${p.valid ? '' : 'bad'}" ${p.valid ? 'da...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:174 | `if (ui.pipelineId && !s.pipelines.some((p) => p.valid && p.id === ui.pipelineId)) ui.pipelineId = null;` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:175 | `const chosen = s.pipelines.find((p) => p.id === ui.pipelineId);` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:176 | `const cells = s.pipelines.map(pipelineCard);` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:181 | `cells.splice(Math.min(cells.length, (Math.floor(s.pipelines.indexOf(chosen) / cols) + 1) * cols), 0, '<div ...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:185 | `const start = s.pipelines.length ? '<div class="pgal">${cells.join('')}</div>' : '<p class="empty">No pipel...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:189 | `<span class="grow">${esc(pipeName(r.pipeline_id))} <span class="meta" data-ago="${esc(r.started_at)}">${esc...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:195 | `<span class="grow">${esc((s.projects.find((p) => p.id === r.project_id) \|\| {}).name \|\| 'other project')...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:208 | `if (run.status === 'running' \|\| run.status === 'paused') actions.push('<button class="danger" data-action...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:209 | `if ((run.status === 'paused' && run.paused_why !== 'gate' && run.paused_why !== 'handoff') \|\| run.status ...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:219 | `<div class="toolbar"><h3 style="margin:0">${esc(pipeName(run.pipeline_id))}</h3><span class="state ${esc(ru...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:229 | `const vs = ui.snap.variants \|\| [];` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:236 | `return '<div class="card ${v.status === 'picked' ? 'on' : ''} ${live ? '' : 'gone'}"${ready ? ' data-action...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:238 | `${live && v.branch ? '<label class="meta"><input type="checkbox" data-action="variant-toggle" data-idx="${v...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:242 | `${ready ? '<button data-action="variant-pane" data-id="${esc(v.pane_id)}">Pane</button>' : ''}` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:243 | `${live && v.status !== 'picked' ? '<button class="primary" data-action="variant-pick" data-idx="${v.idx}">P...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:244 | `${live ? '<button class="danger" data-action="variant-discard" data-idx="${v.idx}">Discard</button>' : ''}` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:250 | `<span></span><div><button data-action="variant-combine" ${n < 2 ? 'disabled' : ''}>Combine ${n} selected</b...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:325 | `if (run) return run.status === 'running' ? 'working' : run.status === 'paused' ? 'waiting_for_you' : 'idle';` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:330 | `tag: p.session_id ? ownerOf(p.session_id) : p.variant !== null ? 'variant ${p.variant + 1}' : runOf(p) ? '$...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:335 | `else if (!pane) body = '<p class="empty">No browser pane. Open one, or run a pipeline step with browser: tr...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:394 | `const pipe = s.pipelines.find((p) => p.id === m.run.pipeline_id);` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:396 | `const n = s.runs.filter((r) => r.pipeline_id === m.run.pipeline_id && r.started_at <= m.run.started_at).len...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:403 | `id: m.run.id, name: '${pipe ? pipe.title \|\| pipe.id : m.run.pipeline_id} #${n}', check, before: shot('bef...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:442 | `return { schema: 1, id: 'new-pipeline', title: 'New pipeline', steps: [{ id: 'work', kind: 'agent', role: '...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:448 | `if (!s.pipelines.length) return '<div class="toolbar"><button class="primary" data-action="new-pipeline">Ne...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:449 | `const p = s.pipelines.find((x) => x.id === ui.pipeSel) \|\| s.pipelines[0];` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:450 | `const runs = s.runs.filter((r) => !r.parent_run && r.pipeline_id === p.id).sort((a, b) => (a.started_at < b...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:453 | `const list = s.pipelines.map((x) => '<button class="link prow ${x.id === p.id ? 'on' : ''}" data-action="pi...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:458 | `${p.source === 'project' ? '<button class="btn" data-action="edit-pipeline" data-id="${esc(p.id)}">${p.vali...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:463 | `return '<div class="pipes"><div class="plist"><div class="toolbar"><h3 style="margin:0" class="grow">Pipeli...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:482 | `const r = await rpc('template.list', {}, true);` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:509 | `if (st.kind === 'action' \|\| st.kind === 'pipeline') {` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:510 | `body += field('Uses', '<input ${f('uses')} value="${esc(st.uses \|\| '')}" placeholder="${st.kind === 'acti...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:534 | `<button class="primary" data-action="save-pipeline">Save to project</button>` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:559 | `const title = h && h.variant !== undefined ? 'Picked variant ${h.variant + 1} (${esc(h.branch)})' : 'Staged...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:566 | `${h.files.length ? '<div class="log">${esc(h.stat)}</div>' : '<p class="empty">${h.variant !== undefined ? ...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:650 | `const TABS = [['diff', 'Diff'], ['git', 'Git'], ['handback', 'Hand-back'], ['browser', 'Browser'], ['runs',...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:729 | `const pipe = s.pipelines.find((p) => p.id === run.pipeline_id);` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:768 | `const head = label ? '<span class="needs-run">${esc(label)}</span> step' : '${esc(pipeName(steps.run.pipeli...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:769 | `return '<div class="steps"><div class="s cur" data-action="run-open" data-id="${esc(steps.run.id)}" title="...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:795 | `if (!run \|\| !['running', 'paused'].includes(run.status)) return '';` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:849 | `const pipe = steps && steps.run ? ui.snap.pipelines.find((p) => p.id === steps.run.pipeline_id) : null;` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:852 | `<div class="gt"><span class="dm"></span><b>${esc(pipe ? pipe.title : g.pipeline_id)}</b>${pipe ? ringHtml(p...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:874 | `return '<span><b>${esc(pipeName(r.pipeline_id))}</b> step ${st ? '${Math.min(st.at, st.list.length)}/${st.l...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:900 | `try { r = await rpc('gate.resolve', params); } catch (e) { r = { error: e }; toast(e.message, true); }` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:988 | `return '<div class="run1" data-action="run-open" data-id="${esc(r.id)}">${esc(pipeName(r.pipeline_id))} <sp...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1009 | `const title = run && ((ui.snap.pipelines.find((p) => p.id === run.pipeline_id) \|\| {}).title \|\| run.pipe...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1043 | `const pipe = run && ui.snap.pipelines.find((p) => p.id === run.pipeline_id);` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1154 | `for (const p of s.pipelines.filter((x) => x.valid)) items.push({ group: 'Run', label: 'Run ${p.title}', met...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1155 | `? () => { if (ui.pipelineId !== p.id) clearInputDrafts(); ui.pipelineId = p.id; openTab('runs'); }` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1156 | `: async () => { const r = await rpc('run.start', { pipeline_id: p.id, project_id: ui.projectId, inputs: {} ...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1157 | `for (const r of s.runs.filter((x) => !x.parent_run).slice(0, 8)) items.push({ group: 'Runs', label: 'Open r...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1159 | `const title = (s.pipelines.find((p) => p.id === r.pipeline_id) \|\| {}).title \|\| r.pipeline_id;` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1162 | `if (armCancel(r.id)) { await rpc('run.cancel', { run_id: r.id }); render(); return; }` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1247 | `if (tab === 'pipelines') await loadTemplates();` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1316 | `else if (ui.tab === 'pipelines') html = renderPipelines();` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1391 | `const r = await rpc('pipeline.validate', { json }, true);` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1393 | `ed.errors = r.result ? r.result.errors : [r.error ? r.error.message : 'the core is offline, so the pipeline...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1617 | `await rpc('run.clear', { project_id: ui.projectId });` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1638 | `if (ui.pipelineId !== id) clearInputDrafts();` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1639 | `ui.pipelineId = ui.pipelineId === id ? null : id;` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1647 | `const chosen = ui.snap.pipelines.find((p) => p.id === ui.pipelineId);` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1655 | `const r = await rpc('run.start', { pipeline_id: chosen.id, project_id: ui.projectId, inputs });` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1666 | `await rpc('run.cancel', { run_id: runId });` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1751 | `case 'variant-toggle': {` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1757 | `case 'variant-pane':` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1766 | `case 'variant-pick': {` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1767 | `const r = await rpc('variant.pick', { run_id: ui.runId, idx: Number(el.dataset.idx) });` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1771 | `case 'variant-discard': {` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1773 | `if (!window.confirm('Discard variant ${idx + 1}? This removes its worktree and branch, stops its dev server...` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1774 | `await rpc('variant.discard', { run_id: ui.runId, idx });` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1777 | `case 'variant-combine': {` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1779 | `if (!note.trim()) { toast('Write a note saying what to take from each variant.', true); return; }` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1780 | `const r = await rpc('variant.combine', { run_id: ui.runId, indices: ui.combine, note });` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1790 | `const r = await rpc('run.resume', params);` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1891 | `case 'new-pipeline':` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1899 | `if (ui.pipelineId !== id) clearInputDrafts();` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1900 | `ui.pipelineId = id;` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1906 | `menu.innerHTML = '<div class="item" data-action="copy-pipeline" data-id="${esc(id)}">Make my own copy</div>';` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1912 | `case 'edit-pipeline':` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1913 | `case 'copy-pipeline': {` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1916 | `if (!text) return toast('Could not read that pipeline file.', true);` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1941 | `case 'save-pipeline': {` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:1948 | `const v = await rpc('pipeline.validate', { json }, true);` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:2024 | `if (el.dataset.action === 'pick-pipeline') {` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:2025 | `ui.pipelineId = el.value;` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| workbench/renderer/app.js:2111 | `if (ui.tab === 'pipelines') await loadTemplates();` | remove | Runs and Pipelines tabs, run screen and bars, gate cards, variants, board and the pipeline editor removed |
| core/src/plugins/manifest.ts:54 | `pipelines?: string[];` | remove | pipeline-only `pipelines` manifest field removed; `gate.resolve` no longer exists |
| core/src/plugins/manifest.ts:63 | `'core.stop', 'ui.hello', 'gate.resolve', 'hooks.install', 'hooks.uninstall',` | remove | pipeline-only `pipelines` manifest field removed; `gate.resolve` no longer exists |
| core/src/plugins/manifest.ts:157 | `(m.pipelines ?? []).forEach((p, i) => {` | remove | pipeline-only `pipelines` manifest field removed; `gate.resolve` no longer exists |
| core/src/plugins/manifest.ts:159 | `if (!abs) errors.push('/pipelines/${i}: path must stay inside the plugin folder');` | remove | pipeline-only `pipelines` manifest field removed; `gate.resolve` no longer exists |
| core/src/plugins/manifest.ts:160 | `else if (!fs.existsSync(abs)) errors.push('/pipelines/${i}: ${p} does not exist');` | remove | pipeline-only `pipelines` manifest field removed; `gate.resolve` no longer exists |
| core/src/pipe/commands.ts:26 | `'core.ping', 'core.stop', 'ui.hello', 'session.focus', 'session.live-text', 'engines.check', 'pipeline.vali...` | remove | removed method names dropped from `NOT_QUEUED` |
| core/src/pipe/commands.ts:28 | `'session.launch', 'session.resume', 'run.start', 'variant.combine',` | remove | removed method names dropped from `NOT_QUEUED` |
| core/src/pipe/commands.ts:53 | `export class CommandRunner {` | keep | `CommandRunner` is the pipe command queue, not the pipeline runner |
| core/src/pipelines/assists.ts:30 | `registryCache ??= JSON.parse(fs.readFileSync(path.join(repoDir, 'pipelines', 'assists', 'registry.json'), '...` | move | file left for `../suite-of-products/shared/core/src/pipelines/assists.ts` |
| core/src/pipelines/assists.ts:40 | `else if (typeof tool.egress !== 'string' \|\| !tool.egress) errors.push('/assists/${i}: helper ${a.tool} ha...` | move | file left for `../suite-of-products/shared/core/src/pipelines/assists.ts` |
| core/src/pipelines/assists.ts:41 | `for (const s of a.steps) if (!steps.has(s)) errors.push('/assists/${i}: step ${s} is not in the pipeline');` | move | file left for `../suite-of-products/shared/core/src/pipelines/assists.ts` |
| workbench/renderer/layouts/bar.js:37 | `const p = s.pipelines.find((x) => x.id === r.pipeline_id);` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/bar.js` |
| workbench/renderer/layouts/bar.js:45 | `if (run.pipeline_id === 'e2e-browser-qa') return findingStore.get(ctx.api, run.id, sig, ctx.render);` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/bar.js` |
| workbench/renderer/layouts/bar.js:46 | `if (run.pipeline_id === 'two-engine-review') return reviewStore.get(ctx.api, run.id, sig, ctx.render);` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/bar.js` |
| workbench/renderer/layouts/bar.js:47 | `if (!rules.RULES[run.pipeline_id]) return null;` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/bar.js` |
| workbench/renderer/layouts/bar.js:77 | `const p = ctx.snap().pipelines.find((x) => x.id === run.pipeline_id);` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/bar.js` |
| workbench/renderer/layouts/bar.js:78 | `const id = (p && p.title) \|\| run.pipeline_id;` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/bar.js` |
| workbench/renderer/layouts/bar.js:79 | `const secs = Math.round(((run.ended_at ? Date.parse(run.ended_at) : Date.now()) - Date.parse(run.started_at...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/bar.js` |
| workbench/renderer/layouts/bar.js:85 | `if (run.status !== 'done') return { text: '${id} · ${run.status}', last: '', hot: true };` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/bar.js` |
| core/src/pipelines/panes.ts:12 | `const run = db.prepare('SELECT r.run_dir, r.pipeline_id, p.path AS project_dir FROM run r JOIN project p ON...` | move | file left for `../suite-of-products/shared/core/src/pipelines/panes.ts` |
| core/src/pipelines/panes.ts:13 | `\| { run_dir: string; pipeline_id: string; project_dir: string }` | move | file left for `../suite-of-products/shared/core/src/pipelines/panes.ts` |
| core/src/pipelines/panes.ts:16 | `const file = db.prepare('SELECT path FROM pipeline WHERE id = ?').get(run.pipeline_id) as { path: string } ...` | move | file left for `../suite-of-products/shared/core/src/pipelines/panes.ts` |
| workbench/renderer/layouts/layouts.css:1 | `.runscreen { position: absolute; z-index: 19; left: 8px; right: 8px; top: 48px; bottom: 60px; display: flex...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/layouts.css` |
| workbench/renderer/layouts/layouts.css:79 | `.runscreen .tb { overflow-wrap: anywhere; font-variant-ligatures: none; padding: 12px 18px; font-family: va...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/layouts.css` |
| workbench/renderer/layouts/layouts.css:267 | `/* variants grid */` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/layouts.css` |
| workbench/renderer/layouts/layouts.css:268 | `.L-variants-grid { display: flex; flex-direction: column; gap: 8px; }` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/layouts.css` |
| workbench/renderer/layouts/layouts.css:269 | `.L-variants-grid .gatebox { position: relative; padding: 12px 16px; border-radius: var(--r); border: 1px do...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/layouts.css` |
| workbench/renderer/layouts/layouts.css:270 | `.L-variants-grid .grid { flex: 1; min-height: 0; overflow: auto; display: grid; grid-template-columns: repe...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/layouts.css` |
| workbench/renderer/layouts/layouts.css:271 | `.L-variants-grid .vt { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 12px 1...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/layouts.css` |
| workbench/renderer/layouts/layouts.css:272 | `.L-variants-grid .vt.open { cursor: pointer; }` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/layouts.css` |
| workbench/renderer/layouts/layouts.css:273 | `.L-variants-grid .vt.open:hover { border-color: var(--body); }` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/layouts.css` |
| workbench/renderer/layouts/layouts.css:274 | `.L-variants-grid .vt.s-picked { border-color: var(--body); }` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/layouts.css` |
| workbench/renderer/layouts/layouts.css:275 | `.L-variants-grid .vt.s-discarded { opacity: .5; }` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/layouts.css` |
| workbench/renderer/layouts/layouts.css:276 | `.L-variants-grid .vth { display: flex; align-items: center; gap: 10px; }` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/layouts.css` |
| workbench/renderer/layouts/layouts.css:277 | `.L-variants-grid .vth b { font-size: 16px; color: var(--body-strong); }` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/layouts.css` |
| workbench/renderer/layouts/layouts.css:278 | `.L-variants-grid .vth .sp { flex: 1; }` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/layouts.css` |
| workbench/renderer/layouts/layouts.css:279 | `.L-variants-grid .mt { font-size: 10.5px; color: var(--faint); }` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/layouts.css` |
| workbench/renderer/layouts/layouts.css:280 | `.L-variants-grid .prl { font-family: var(--mono); font-size: 12px; }` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/layouts.css` |
| workbench/renderer/layouts/layouts.css:281 | `.L-variants-grid .vta { display: flex; gap: 12px; }` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/layouts.css` |
| core/src/pipelines/validate.ts:13 | `kind: 'agent' \| 'action' \| 'pipeline' \| 'code' \| 'gate';` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:53 | `/** Another pipeline by id, for 'kind: pipeline' steps; null when unknown. */` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:54 | `pipeline: (id: string) => Pipeline \| null;` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:57 | `/** Folder of the pipeline file, to check 'code' paths; null for a pipeline that is not on disk. */` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:63 | `function pipelineSchema(): Record<string, unknown> {` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:64 | `schemaCache ??= JSON.parse(fs.readFileSync(path.join(repoDir, 'contracts', 'pipeline.schema.json'), 'utf8'));` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:68 | `export function parseUses(uses: string): { kind: 'plugin'; plugin: string; action: string } \| { kind: 'pip...` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:71 | `m = /^pipeline:([a-z0-9-]+)$/.exec(uses);` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:72 | `return m ? { kind: 'pipeline', id: m[1] } : null;` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:89 | `/** Schema errors, then the rules in pipelines.md "Validation" in their numbered order. */` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:91 | `const errors = validate(pipelineSchema(), json);` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:115 | `if (ref.root === 'variants') {` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:175 | `if (s.kind === 'pipeline' && u?.kind !== 'pipeline') errors.push('${at(i, s)}/uses: a pipeline step uses pi...` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:206 | `if (s.kind !== 'pipeline' \|\| !s.uses) continue;` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:208 | `if (u?.kind !== 'pipeline') continue;` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:210 | `errors.push('step ${s.id}: pipeline ${u.id} includes itself (${[...chain, u.id].join(' > ')})');` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:214 | `errors.push('step ${s.id}: pipelines nest at most 3 levels deep (${[...chain, u.id].join(' > ')})');` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:217 | `const child = ctx.pipeline(u.id);` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| core/src/pipelines/validate.ts:219 | `errors.push('step ${s.id}: pipeline ${u.id} is not known');` | move | file left for `../suite-of-products/shared/core/src/pipelines/validate.ts` |
| workbench/renderer/layouts/pr-first.js:15 | `else merge = '<div class="mb"><div class="mt">${h.esc(gate ? '${gate.title}: ${h.label(gate)}' : 'No merge ...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/pr-first.js` |
| workbench/renderer/layouts/rules.js:1 | `// Picks the layout a pipeline run is shown on, and decides when an automatic pick may move the screen.` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/rules.js:11 | `const variantsMoment = (list = []) => (status(list, 'approve-directions') === 'waiting' ? 'directions' : st...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/rules.js:17 | `/** A pipeline whose rule is a first-match list of [moment, layout]; moment(list, run, data) names where th...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/rules.js:55 | `'design-variants': {` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/rules.js:56 | `five: ['variants-grid', 'artifact-columns', 'preview-stage', 'agent-split', 'artifact-columns'],` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/rules.js:59 | `const m = variantsMoment(list);` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/rules.js:60 | `if (m) return m === 'directions' ? 'artifact-columns' : 'variants-grid';` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/rules.js:62 | `if (status(list, 'variants') === 'running') return 'variants-grid';` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/rules.js:65 | `opens: (data, list) => Boolean(variantsMoment(list)),` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/rules.js:66 | `moment: variantsMoment,` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/rules.js:98 | `['variants-grid', 'preview-stage', 'timeline', 'pr-first', 'run-log'],` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/rules.js:100 | `{ pick: 'variants-grid', flag: 'preview-stage', approve: 'pr-first' },` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/rules.js:142 | `const ruleOf = (pipelineId) => RULES[pipelineId] \|\| { five: LIBRARY, onFail: 'run-log', pick: () => null };` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/rules.js:154 | `/** run: { pipeline_id }, pipe: { layout } or null, list: stepsOf().list, manual: a layout name or null, da...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/rules.js:156 | `const rule = ruleOf(run.pipeline_id);` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/rules.js:183 | `/** Whether a background run should open itself: the pipeline's open rule, or any failed step. */` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/rules.js:185 | `const rule = ruleOf(run.pipeline_id);` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/rules.js:190 | `const moment = (run, list, data) => (ruleOf(run.pipeline_id).moment \|\| (() => ''))(list, run, data);` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/rules.js` |
| workbench/renderer/layouts/preview-stage.js:16 | `...m.variants.filter((v) => v.status === 'picked').map((v) => box('Picked variant ${String.fromCharCode(65 ...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/preview-stage.js` |
| core/src/pipelines/runner.ts:36 | `pipeline_id: string;` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:70 | `pipeline_id: string;` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:127 | `export class Runner {` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:131 | `private boardCapture: BoardCapture \| null = null;` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:139 | `this.boardCapture = capture;` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:150 | `private pipelineOf(run: RunRow): Pipeline {` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:151 | `return JSON.parse(fs.readFileSync(path.join(run.run_dir, 'pipeline.json'), 'utf8')) as Pipeline;` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:173 | `const entry = found.get(params.pipeline_id);` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:174 | `if (!entry) throw new RpcError(E.NOT_FOUND, 'pipeline ${params.pipeline_id} not found');` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:176 | `if (errors.length) throw new RpcError(E.VALIDATION, 'pipeline ${params.pipeline_id} is invalid', { errors });` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:189 | `fs.writeFileSync(path.join(runDir, 'pipeline.json'), JSON.stringify(snapshot, null, 2) + '\n');` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:194 | `'INSERT INTO run (id, pipeline_id, parent_run, parent_step, depth, project_id, inputs, run_dir, status, tri...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:201 | `this.log(run, { event: 'run started', pipeline: pipe.id });` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:228 | `if (['done', 'failed', 'cancelled'].includes(run.status) && run.status !== 'failed') return;` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:236 | `if (run.status === 'running') return;` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:237 | `if (run.status === 'done' \|\| run.status === 'cancelled') throw new RpcError(E.VALIDATION, 'run is ${run.s...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:305 | `/** Moves the run's live step rows to a terminal status, discards variants still building and closes its pa...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:308 | `this.db.prepare("UPDATE variant SET status = 'discarded' WHERE run_id = ? AND status = 'building'").run(run...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:324 | `this.db.prepare("UPDATE variant SET worktree = '' WHERE run_id = ? AND worktree = ?").run(run.id, slash(dir));` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:345 | `if (first && !fs.existsSync(path.join(first.run_dir, 'assists.json'))) await detectAssists(this.pipelineOf(...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:348 | `if (!run \|\| run.status !== 'running') return;` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:349 | `const pipe = this.pipelineOf(run);` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:367 | `if (run && run.status === 'running') this.fail(run, 'runner error: ${(e as Error).message}');` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:428 | `/** Tokens (input, output and cache writes) and dollars used by a run and its sub-pipeline runs. */` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:448 | `/** Wall-clock minutes since the run started, less the time it or its sub-pipeline runs waited at a gate, s...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:457 | `const start = Date.parse(run.started_at);` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:478 | `const pipelineOf = (r: RunRow) => this.pipelineOf(r);` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:492 | `get pipeline() {` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:493 | `const dir = (pipelineOf(run) as Pipeline & { source_dir?: string }).source_dir;` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:496 | `picked: () => (this.db.prepare("SELECT worktree, branch FROM variant WHERE run_id = ? AND status = 'picked'...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:592 | `else result = await this.pipelineIndex(run, step, row);` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:598 | `if ('ok' in result && result.ok && fanout && step.worktree) this.db.prepare("UPDATE variant SET status = 'r...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:671 | `'INSERT INTO variant (run_id, idx, worktree, branch, dev_port, status) VALUES (?, ?, ?, ?, ?, 'building')` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:677 | `const existing = this.db.prepare('SELECT id FROM browser_pane WHERE run_id = ? AND variant = ? AND open = 1...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:680 | `this.db.prepare('INSERT INTO browser_pane (id, project_id, run_id, variant, dev_port, open) VALUES (?, ?, ?...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:682 | `if (step.fanout && step.worktree) this.db.prepare('UPDATE variant SET pane_id = ? WHERE run_id = ? AND idx ...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:726 | `const helpers = helperBlock(this.pipelineOf(run), run.run_dir, stepId);` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:907 | `if (!this.boardCapture) {` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:911 | `const { captured, failures } = await captureBoard(this.db, run.project_id, items, this.boardCapture);` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1043 | `private async pipelineIndex(run: RunRow, step: Step, row: StepRow): Promise<IndexResult> {` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1045 | `if (u?.kind !== 'pipeline') return { ok: false, error: 'bad uses ${step.uses}' };` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1050 | `const id = this.start({ pipeline_id: u.id, project_id: run.project_id, inputs, trigger: 'manual' }, { run, ...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1063 | `const pipe = this.pipelineOf(c);` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1071 | `return { ok: false, error: 'sub-pipeline ${u.id} ${c.status}' };` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1203 | `/** At core start: steps that were mid-way through an action, code or sub-pipeline fail; agent steps reatta...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1210 | `if (run.status !== 'running') continue;` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1213 | `step = this.pipelineOf(run).steps.find((s) => s.id === r.step_id);` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1231 | `if (step?.kind === 'pipeline') continue;` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1239 | `this.db.prepare('UPDATE browser_pane SET url = NULL WHERE EXISTS (SELECT 1 FROM dev_server d WHERE d.run_id...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1251 | `/** Refuses Continue on a handoff gate step after a fan-out worktree step while no variant is picked. */` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1255 | `const steps = this.pipelineOf(run).steps;` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1259 | `if (this.db.prepare("SELECT 1 FROM variant WHERE run_id = ? AND status = 'picked'").get(runId)) return;` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1260 | `throw new RpcError(E.VALIDATION, 'pick a tile first', { errors: ['no variant is picked'] });` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1264 | `const v = this.db.prepare('SELECT status FROM variant WHERE run_id = ? AND idx = ?').get(runId, idx) as { s...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1265 | `if (!v) throw new RpcError(E.NOT_FOUND, 'variant not found');` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1266 | `if (v.status !== 'ready' && v.status !== 'picked') throw new RpcError(E.VALIDATION, 'variant is ${v.status}...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1267 | `this.db.prepare("UPDATE variant SET status = 'ready' WHERE run_id = ? AND status = 'picked'").run(runId);` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1268 | `this.db.prepare("UPDATE variant SET status = 'picked' WHERE run_id = ? AND idx = ?").run(runId, idx);` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1271 | `/** Stops the variant's dev server tree, releases its port, closes its pane and removes its worktree and br...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1273 | `const v = this.db.prepare('SELECT worktree, branch, pane_id FROM variant WHERE run_id = ? AND idx = ?').get...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1276 | `if (!v) throw new RpcError(E.NOT_FOUND, 'variant not found');` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1297 | `this.db.prepare("UPDATE variant SET status = 'discarded' WHERE run_id = ? AND idx = ?").run(runId, idx);` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1300 | `/** Starts an agent in a fresh worktree from project HEAD as the next variant, given the note and each sele...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1306 | `if (chosen.length < 2) throw invalid('combine needs at least 2 different variants');` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1308 | `const variants = chosen.map((idx) => {` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1309 | `const v = this.db.prepare('SELECT idx, worktree, branch, pane_id, status FROM variant WHERE run_id = ? AND ...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1312 | `if (!v) throw new RpcError(E.NOT_FOUND, 'variant ${idx} not found');` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1313 | `if (v.status === 'discarded') throw invalid('variant ${idx} was discarded');` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1314 | `if (!v.worktree) throw invalid('variant ${idx} has no worktree');` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1317 | `const pipe = this.pipelineOf(run);` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1323 | `const idx = (this.db.prepare('SELECT COALESCE(MAX(idx), -1) + 1 AS n FROM variant WHERE run_id = ?').get(ru...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1324 | `this.db.prepare("INSERT INTO variant (run_id, idx, worktree, branch, dev_port, status) VALUES (?, ?, '', ''...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1333 | `for (const v of variants) {` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1337 | `fs.writeFileSync(path.join(dir, 'variant-${v.idx}.diff'), git(v.worktree, ['diff', base]));` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1339 | `this.log(run, { event: 'combine diff failed', variant: v.idx, why: (e as Error).message });` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1342 | `this.log(run, { event: 'combine crop skipped', variant: v.idx, why: v.pane_id ? 'browser not available' : '...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1347 | `fs.copyFileSync(shot.w1280_path, path.join(dir, 'variant-${v.idx}.png'));` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1349 | `this.log(run, { event: 'combine crop failed', variant: v.idx, why: (e as Error).message });` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1355 | `'Combine variants ${chosen.join(', ')} into one result in this worktree, which starts from the project's HE...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1357 | `'Each variant's diff against the project and its screenshot are in these files:\n${listed.map((f) => '- ${f...` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/runner.ts:1361 | `this.log(run, { event: 'combine started', step: stepId, variants: chosen, index: idx });` | move | file left for `../suite-of-products/shared/core/src/pipelines/runner.ts` |
| core/src/pipelines/template.ts:5 | `root: 'inputs' \| 'steps' \| 'run' \| 'project' \| 'pipeline' \| 'port' \| 'variants' \| 'index';` | move | file left for `../suite-of-products/shared/core/src/pipelines/template.ts` |
| core/src/pipelines/template.ts:15 | `/** Parses one reference; null when it is outside the allowed grammar in pipeline.schema.json. */` | move | file left for `../suite-of-products/shared/core/src/pipelines/template.ts` |
| core/src/pipelines/template.ts:25 | `if (expr === 'pipeline.dir') return { raw: expr, root: 'pipeline', name: 'dir' };` | move | file left for `../suite-of-products/shared/core/src/pipelines/template.ts` |
| core/src/pipelines/template.ts:28 | `m = /^variants\.picked\.(worktree\|branch)$/.exec(expr);` | move | file left for `../suite-of-products/shared/core/src/pipelines/template.ts` |
| core/src/pipelines/template.ts:29 | `if (m) return { raw: expr, root: 'variants', key: m[1] };` | move | file left for `../suite-of-products/shared/core/src/pipelines/template.ts` |
| core/src/pipelines/template.ts:50 | `pipeline?: { dir: string };` | move | file left for `../suite-of-products/shared/core/src/pipelines/template.ts` |
| core/src/pipelines/template.ts:69 | `case 'pipeline':` | move | file left for `../suite-of-products/shared/core/src/pipelines/template.ts` |
| core/src/pipelines/template.ts:70 | `if (!scope.pipeline) throw new Error('{{pipeline.dir}} needs a pipeline file on disk');` | move | file left for `../suite-of-products/shared/core/src/pipelines/template.ts` |
| core/src/pipelines/template.ts:71 | `return scope.pipeline.dir;` | move | file left for `../suite-of-products/shared/core/src/pipelines/template.ts` |
| core/src/pipelines/template.ts:78 | `case 'variants': {` | move | file left for `../suite-of-products/shared/core/src/pipelines/template.ts` |
| core/src/pipelines/template.ts:80 | `if (!v) throw new Error('no variant is picked; pick a tile, then Continue');` | move | file left for `../suite-of-products/shared/core/src/pipelines/template.ts` |
| core/src/hook/browser-mcp.ts:22 | `{ name: 'screenshot', description: 'PNG of the viewport, or the full page. In a pipeline step, save_as (a l...` | remove | `save_as` (pipeline step shots) removed from `screenshot` |
| core/src/sessions/launch.ts:71 | `const plan = planArgs(opts.engine, opts.prompt, approval, [...(opts.extraArgs ?? []), ...agentsMdArgs(opts....` | keep | the external-writes rule still guards any session launched with a run id; pipeline apps launch sessions through the pipe (D54) |
| core/src/sessions/launch.ts:74 | `env = mcpAttachEnv(db, opts.engine, id, opts.browser, { pipeline: Boolean(opts.runId), approval });` | keep | the external-writes rule still guards any session launched with a run id; pipeline apps launch sessions through the pipe (D54) |
| workbench/renderer/layouts/variants-grid.js:1 | `// Variants grid: one tile per fan-out variant with its server link, last agent line, and Pick, Pane and Di...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/variants-grid.js` |
| workbench/renderer/layouts/variants-grid.js:2 | `runLayouts['variants-grid'] = {` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/variants-grid.js` |
| workbench/renderer/layouts/variants-grid.js:5 | `const tiles = m.variants.map((v) => {` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/variants-grid.js` |
| workbench/renderer/layouts/variants-grid.js:9 | `const open = v.pane_id && url ? ' data-action="variant-pane" data-id="${h.esc(v.pane_id)}" title="Open this...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/variants-grid.js` |
| workbench/renderer/layouts/variants-grid.js:14 | `<div class="vta">${open ? '<button class="lnk" data-action="variant-pane" data-id="${h.esc(v.pane_id)}">Pan...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/variants-grid.js` |
| workbench/renderer/layouts/variants-grid.js:15 | `${live && v.status !== 'picked' ? '<button class="lnk" data-action="variant-pick" data-idx="${v.idx}">Pick<...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/variants-grid.js` |
| workbench/renderer/layouts/variants-grid.js:16 | `${live ? '<button class="lnk" data-action="variant-discard" data-idx="${v.idx}">Discard</button>' : ''}</di...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/variants-grid.js` |
| workbench/renderer/layouts/variants-grid.js:20 | `<main class="grid">${tiles \|\| '<div class="empty">${h.esc(live ? '${live.title}: ${h.label(live)}' : 'No ...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/variants-grid.js` |
| workbench/renderer/layouts/run.js:1 | `// The run screen: one pipeline run shown full screen over the wall, in the layout layoutRules picks.` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/run.js` |
| workbench/renderer/layouts/run.js:7 | `const NAME = { 'run-log': 'Run log', 'artifact-columns': 'Artifact columns', 'pr-first': 'PR first', pipe: ...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/run.js` |
| workbench/renderer/layouts/run.js:24 | `'variants-grid': '<svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor"><rect x...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/run.js` |
| workbench/renderer/layouts/run.js:40 | `const ended = (run) => ['done', 'failed', 'cancelled'].includes(run.status);` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/run.js` |
| workbench/renderer/layouts/run.js:127 | `const pipe = snap.pipelines.find((p) => p.id === run.pipeline_id) \|\| null;` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/run.js` |
| workbench/renderer/layouts/run.js:128 | `const m = pipeMeta(run.pipeline_id);` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/run.js` |
| workbench/renderer/layouts/run.js:142 | `num: snap.runs.filter((r) => r.pipeline_id === run.pipeline_id && r.started_at <= run.started_at).length,` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/run.js` |
| workbench/renderer/layouts/run.js:147 | `elapsed: (run.ended_at ? Date.parse(run.ended_at) : now) - Date.parse(run.started_at),` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/run.js` |
| workbench/renderer/layouts/run.js:150 | `review: run.pipeline_id === 'two-engine-review' ? reviewStore.get(ctx.api, run.id, list.map((x) => x.status...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/run.js` |
| workbench/renderer/layouts/run.js:151 | `findings: run.pipeline_id === 'e2e-browser-qa' ? findingStore.get(ctx.api, run.id, list.map((x) => x.status...` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/run.js` |
| workbench/renderer/layouts/run.js:155 | `variants: snap.variants \|\| [],` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/run.js` |
| workbench/renderer/layouts/run.js:243 | `const five = rules.ruleOf(m.run.pipeline_id).five;` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/run.js` |
| workbench/renderer/layouts/run.js:280 | `if (e.target.closest('[data-action="variant-pane"]') && !e.target.closest('a, input, label')) return close();` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/run.js` |
| workbench/renderer/layouts/run.js:324 | `if (m) { manual(rules.ruleOf(m.run.pipeline_id).five[Number(e.key) - 1], Number(e.key) - 1); return true; }` | move | file left for `../suite-of-products/shared/workbench/renderer/layouts/run.js` |
| core/src/pipelines/store.ts:30 | `/** Every pipeline file the core can see; a later source wins on a clashing id (built-in, then plugin, then...` | move | file left for `../suite-of-products/shared/core/src/pipelines/store.ts` |
| core/src/pipelines/store.ts:38 | `for (const f of jsonFiles(path.join(repoDir, 'pipelines'))) add('builtin', f);` | move | file left for `../suite-of-products/shared/core/src/pipelines/store.ts` |
| core/src/pipelines/store.ts:41 | `for (const rel of p.manifest.pipelines ?? []) add('plugin:${p.id}', path.resolve(p.path, rel));` | move | file left for `../suite-of-products/shared/core/src/pipelines/store.ts` |
| core/src/pipelines/store.ts:44 | `for (const f of jsonFiles(path.join(row.path, '.troop', 'pipelines'))) add('project', f);` | move | file left for `../suite-of-products/shared/core/src/pipelines/store.ts` |
| core/src/pipelines/store.ts:52 | `pipeline: (id) => (found.get(id)?.json as Pipeline \| undefined) ?? null,` | move | file left for `../suite-of-products/shared/core/src/pipelines/store.ts` |
| core/src/pipelines/store.ts:61 | `/** The template gallery: every 'pipelines/templates/*.json' plus 'pipelines/preview/*.json' (marked 'previ...` | move | file left for `../suite-of-products/shared/core/src/pipelines/store.ts` |
| core/src/pipelines/store.ts:65 | `...jsonFiles(path.join(repoDir, 'pipelines', 'templates')).map((file) => ({ file, preview: false })),` | move | file left for `../suite-of-products/shared/core/src/pipelines/store.ts` |
| core/src/pipelines/store.ts:66 | `...jsonFiles(path.join(repoDir, 'pipelines', 'preview')).map((file) => ({ file, preview: true })),` | move | file left for `../suite-of-products/shared/core/src/pipelines/store.ts` |
| core/src/pipelines/store.ts:76 | `/** Scans every source and upserts 'pipeline' rows with their validation result. */` | move | file left for `../suite-of-products/shared/core/src/pipelines/store.ts` |
| core/src/pipelines/store.ts:81 | `'INSERT INTO pipeline (id, source, path, version, valid, errors) VALUES (?, ?, ?, ?, ?, ?)` | move | file left for `../suite-of-products/shared/core/src/pipelines/store.ts` |
| core/src/browser/shots.ts:8 | `/** Where a pipeline step's screenshot is saved: '<run_dir>/shots/<step>-<round>-<label>.png', round counte...` | move | file left for `../suite-of-products/shared/core/src/browser/shots.ts` |
| core/src/browser/shots.ts:15 | `if (!row) throw new Error('save_as works only in a pipeline step');` | move | file left for `../suite-of-products/shared/core/src/browser/shots.ts` |
| core/src/browser/policy.ts:15 | `/** Ports this pane's project owns ('browser_pane.dev_port', 'variant.dev_port'). */` | replace | comment now names only `browser_pane.dev_port`; session ownership arrives with M6-3 |

## New lines after the split

| Hit | Text | Mark | Why |
|---|---|---|---|
| core/cli.ts:346 | `console.error('troop run: moved to the pipeline products');` | keep | `troop run` now only prints "moved to the pipeline products" and exits 2 (spec step 4) |
| core/src/methods.ts:37 | `'run.start', 'run.cancel', 'run.clear', 'run.resume', 'run.item-set', 'gate.resolve', 'schedule.set', 'pipe...` | keep | the removed method names, each answering -32601 "moved to the pipeline products" (spec step 4) |
| core/src/methods.ts:38 | `'template.list', 'variant.pick', 'variant.discard', 'variant.combine', 'board.pin', 'board.remove',` | keep | the removed method names, each answering -32601 "moved to the pipeline products" (spec step 4) |
| core/src/methods.ts:437 | `for (const name of MOVED_METHODS) m.set(name, { handler: () => { throw new RpcError(E.METHOD_NOT_FOUND, 'mo...` | keep | the removed method names, each answering -32601 "moved to the pipeline products" (spec step 4) |

## Test files

| File | Mark | Why |
|---|---|---|
| core/test/agy-driver.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/agy-driver.test.ts` |
| core/test/assists.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/assists.test.ts` |
| core/test/browser-shots.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/browser-shots.test.ts` |
| core/test/bucket.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/bucket.test.ts` |
| core/test/catalogue-cut.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/catalogue-cut.test.ts` |
| core/test/cli-run.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/cli-run.test.ts` |
| core/test/code-map.test.ts | edit | pipeline cases or imports dropped; the desk cases stay |
| core/test/core.test.ts | edit | pipeline cases or imports dropped; the desk cases stay |
| core/test/design-variants.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/design-variants.test.ts` |
| core/test/devserver.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/devserver.test.ts` |
| core/test/docs-and-release-notes.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/docs-and-release-notes.test.ts` |
| core/test/e2e-browser-qa.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/e2e-browser-qa.test.ts` |
| core/test/gate-when.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/gate-when.test.ts` |
| core/test/licences.test.ts | edit | pipeline cases or imports dropped; the desk cases stay |
| core/test/loop-handback.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/loop-handback.test.ts` |
| core/test/loop-passed.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/loop-passed.test.ts` |
| core/test/m3-e2e.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/m3-e2e.test.ts` |
| core/test/m3-plugins.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/m3-plugins.test.ts` |
| core/test/m5-06-pro.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/m5-06-pro.test.ts` |
| core/test/m5-21-preview-a.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/m5-21-preview-a.test.ts` |
| core/test/m5-21-preview-b.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/m5-21-preview-b.test.ts` |
| core/test/m5-21-preview-c.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/m5-21-preview-c.test.ts` |
| core/test/m5-hardening.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/m5-hardening.test.ts` |
| core/test/meter.test.ts | edit | pipeline cases or imports dropped; the desk cases stay |
| core/test/open-core-seams.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/open-core-seams.test.ts` |
| core/test/perf.test.ts | edit | pipeline cases or imports dropped; the desk cases stay |
| core/test/pick-moment.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/pick-moment.test.ts` |
| core/test/pipe-client.test.ts | edit | pipeline cases or imports dropped; the desk cases stay |
| core/test/pipeline-fixup-helpers.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/pipeline-fixup-helpers.ts` |
| core/test/pipeline-schema.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/pipeline-schema.test.ts` |
| core/test/pipelines-m2.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/pipelines-m2.test.ts` |
| core/test/plugins.test.ts | edit | pipeline cases or imports dropped; the desk cases stay |
| core/test/pure.test.ts | edit | pipeline cases or imports dropped; the desk cases stay |
| core/test/recover.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/recover.test.ts` |
| core/test/repo-failing.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/repo-failing.test.ts` |
| core/test/research-plugins.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/research-plugins.test.ts` |
| core/test/result-file-clash.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/result-file-clash.test.ts` |
| core/test/review-fixes.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/review-fixes.test.ts` |
| core/test/run-cancel.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/run-cancel.test.ts` |
| core/test/run-clear.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/run-clear.test.ts` |
| core/test/runner-fixes.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/runner-fixes.test.ts` |
| core/test/runner.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/runner.test.ts` |
| core/test/secrets-scan.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/secrets-scan.test.ts` |
| core/test/security-review-and-upgrade.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/security-review-and-upgrade.test.ts` |
| core/test/seo-loopback.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/seo-loopback.test.ts` |
| core/test/serve-order.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/serve-order.test.ts` |
| core/test/shipped.test.ts | edit | pipeline cases or imports dropped; the desk cases stay |
| core/test/social-scheduler.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/social-scheduler.test.ts` |
| core/test/spec-build-review-handback-validation.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/spec-build-review-handback-validation.test.ts` |
| core/test/spec-lint.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/spec-lint.test.ts` |
| core/test/template-gallery.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/template-gallery.test.ts` |
| core/test/troop-skill.test.ts | edit | pipeline cases or imports dropped; the desk cases stay |
| core/test/two-engine-review-diff.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/two-engine-review-diff.test.ts` |
| core/test/two-engine-review.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/two-engine-review.test.ts` |
| core/test/ui-revision-helpers.ts | edit | pipeline cases or imports dropped; the desk cases stay |
| core/test/ui-revision.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/ui-revision.test.ts` |
| core/test/variants.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/variants.test.ts` |
| core/test/website-build.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/website-build.test.ts` |
| core/test/worktree-npm.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/core/test/worktree-npm.test.ts` |
| workbench/test/assists-chips.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/assists-chips.test.ts` |
| workbench/test/board.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/board.test.ts` |
| workbench/test/layout-rules.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/layout-rules.test.ts` |
| workbench/test/loop-rules.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/loop-rules.test.ts` |
| workbench/test/m3-rules.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/m3-rules.test.ts` |
| workbench/test/needs-you-runbox.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/needs-you-runbox.test.ts` |
| workbench/test/no-network.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/no-network.test.ts` |
| workbench/test/qa-rules.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/qa-rules.test.ts` |
| workbench/test/queries.test.ts | edit | pipeline cases or imports dropped; the desk cases stay |
| workbench/test/rail-and-handback-bar.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/rail-and-handback-bar.test.ts` |
| workbench/test/renderer-guards.test.ts | edit | pipeline cases or imports dropped; the desk cases stay |
| workbench/test/review-bar.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/review-bar.test.ts` |
| workbench/test/review-rules.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/review-rules.test.ts` |
| workbench/test/run-autoopen.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/run-autoopen.test.ts` |
| workbench/test/run-cancel-ui.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/run-cancel-ui.test.ts` |
| workbench/test/run-detail-render.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/run-detail-render.test.ts` |
| workbench/test/run-file.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/run-file.test.ts` |
| workbench/test/run-screen.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/run-screen.test.ts` |
| workbench/test/rundetail.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/rundetail.test.ts` |
| workbench/test/site-rules.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/site-rules.test.ts` |
| workbench/test/site-shots.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/site-shots.test.ts` |
| workbench/test/start-form.test.ts | edit | pipeline cases or imports dropped; the desk cases stay |
| workbench/test/template-gallery.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/template-gallery.test.ts` |
| workbench/test/ui-revision.test.ts | edit | pipeline cases or imports dropped; the desk cases stay |
| workbench/test/variants-rules.test.ts | move | tests leaving code; copied to `../suite-of-products/shared/workbench/test/variants-rules.test.ts` |
| workbench/test/wall.test.ts | edit | pipeline cases or imports dropped; the desk cases stay |
