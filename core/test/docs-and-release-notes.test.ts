import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { client, isolation, root, scriptedGh, startCore, teardownCore, uiHello, until } from './helpers.ts';

const fake = (d: object) => `FAKE ${JSON.stringify(d)}\n`;
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' });

async function setup(pipelineId: string, fixture: string, ghScript: string) {
  const iso = isolation();
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{ id: 'fake', command: process.execPath, args: [join(root, 'core/test/fake-engine.js')], prompt_arg: 'positional', state_source: 'hooks', roles: ['plan', 'worker', 'review', 'verify', 'visual-check', 'research'], cost_rank: 1, usage_source: 'none', provider: 'local-cli', version_cmd: [process.execPath, '--version'] }]));
  const bin = join(iso.home, 'bin');
  mkdirSync(bin);
  const log = join(bin, 'gh.log');
  scriptedGh(bin, ghScript);
  const project = join(iso.home, 'project');
  cpSync(join(root, 'tests', 'fixtures', fixture), project, { recursive: true });
  git(project, 'init', '-q', '-b', 'main');
  git(project, 'config', 'user.email', 'fixture@example.com');
  git(project, 'config', 'user.name', 'fixture');
  git(project, 'add', '-A');
  git(project, 'commit', '-qm', 'fixture');
  const origin = join(iso.home, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  git(project, 'remote', 'add', 'origin', origin);
  git(project, 'push', '-q', 'origin', 'main');
  const core = await startCore({ ...iso, env: { ...iso.env, METATROOPER_ENGINES: registry, PATH: `${bin}${delimiter}${process.env.PATH}` } });
  const db = new DatabaseSync(join(iso.home, 'troop.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  return { iso, core, db, project, log };
}

function pipeline(id: string, directives: Record<string, object>) {
  const def = JSON.parse(readFileSync(join(root, 'pipelines', `${id}.json`), 'utf8'));
  for (const step of def.steps) {
    if (step.kind === 'agent') step.engine = 'fake';
    if (directives[step.id]) step.prompt = fake(directives[step.id]) + step.prompt;
  }
  return def;
}

async function gate(db: DatabaseSync, runId: string, stepId: string) {
  return until(() => {
    const run = db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as { status: string };
    if (run.status === 'failed' || run.status === 'done') {
      const steps = db.prepare('SELECT step_id, fanout_index, status FROM run_step WHERE run_id = ?').all(runId).map((s: any) => `${s.step_id}/${s.fanout_index}=${s.status}`);
      const notes = db.prepare('SELECT text FROM needs_you ORDER BY rowid').all().map((n: any) => n.text);
      throw new Error(`run ${run.status} before gate ${stepId}: ${steps.join(' ')} | ${notes.join(' | ')}`);
    }
    return db.prepare("SELECT id, guards_step, action_hash FROM gate WHERE run_id = ? AND step_id = ? AND status = 'waiting'").get(runId, stepId) as { id: string; guards_step: string | null; action_hash: string | null } | undefined;
  }, 60_000);
}

test('M2-01 docs-and-release-notes runs on a fixture project, stops at the approve gate before release, and calls gh release only after approval', async () => {
  const ghScript = `import fs from 'node:fs'; const args = process.argv.slice(2); fs.appendFileSync(new URL('gh.log', import.meta.url), args.join(' ') + '\\n'); if (args[0] === 'pr') console.log(JSON.stringify([{number:1,title:'Add docs',labels:[{name:'feature'}],mergedAt:'2026-01-01T00:00:00Z',url:'https://github.com/fake/repo/pull/1',author:{login:'fixture'},body:'Docs change'}])); else if (args[0] === 'release' && args[1] === 'view') process.exit(1); else if (args[0] === 'release' && args[1] === 'create') console.log('https://github.com/fake/repo/releases/tag/' + args[2]);`;
  const t = await setup('docs-and-release-notes', 'docs-and-release-notes-project', ghScript);
  try {
    const def = pipeline('docs-and-release-notes', {
      map: { outputs: { summary: 'Docs map ready', breaking_no_doc: false } },
      update: { outputs: { summary: 'Docs updated' } },
      changelog: { outputs: { bump: 'minor', version: 'v2.4.0' } },
      samples: { outputs: { passed: true } },
    });
    mkdirSync(join(t.project, '.troop', 'pipelines'), { recursive: true });
    writeFileSync(join(t.project, '.troop', 'pipelines', 'docs-and-release-notes.json'), JSON.stringify(def));
    const pipe = await client(t.iso.prefix);
    try {
      await uiHello(pipe, t.iso.home);
      const projectId = (await pipe.request('project.open', { path: t.project })).result.project_id;
      const started = await pipe.request('run.start', { pipeline_id: 'docs-and-release-notes', project_id: projectId, inputs: { repo: 'fake/repo', base_branch: 'main' } }, { timeout: 5000 });
      const runId = started.result.run_id as string;
      const approve = await gate(t.db, runId, 'approve');
      assert.equal(approve.guards_step, 'release');
      const releaseStep = t.db.prepare("SELECT status FROM run_step WHERE run_id = ? AND step_id = 'release'").get(runId) as { status: string } | undefined;
      assert.ok(!releaseStep || releaseStep.status === 'pending');
      const before = existsSync(t.log) ? readFileSync(t.log, 'utf8') : '';
      assert.ok(!before.split(/\r?\n/).some(line => line.startsWith('release create ')), before);
      const changelog = JSON.parse((t.db.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'changelog'").get(runId) as { outputs: string }).outputs);
      assert.equal(changelog.version, 'v2.4.0');
      assert.deepEqual((await pipe.request('gate.resolve', { gate_id: approve.id, decision: 'approve', action_hash: approve.action_hash }, { timeout: 5000 })).result, {});
      const status = await until(() => {
        const row = t.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as { status: string };
        return ['done', 'failed'].includes(row.status) ? row.status : null;
      }, 60_000);
      assert.equal(status, 'done');
      const calls = readFileSync(t.log, 'utf8').trim().split(/\r?\n/).filter(line => line.startsWith('release create '));
      assert.equal(calls.length, 1);
      assert.match(calls[0], /^release create v2\.4\.0 --repo fake\/repo --target main /);
    } finally { pipe.close(); }
  } finally { t.db.close(); await teardownCore(t.core, t.iso); }
});
