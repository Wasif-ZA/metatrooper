import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildGenerated, isolation, sleep, until } from './helpers.ts';

const home = isolation();
const prior = { ...process.env };
let term: typeof import('../src/terminal/index.ts');
let events: typeof import('../src/terminal/events.ts');

before(async () => {
  await buildGenerated();
  Object.assign(process.env, home.env);
  term = await import('../src/terminal/index.ts');
  events = await import('../src/terminal/events.ts');
});

after(async () => {
  term?.killAll();
  await sleep(100);
  rmSync(home.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
  Object.assign(process.env, prior);
});

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true }).map((f) => join(dir, String(f))).filter((f) => statSync(f).isFile());
}

test('M1-05 a marker typed into a terminal session appears in no table or file under the data folder', async () => {
  const { openCoreDb } = await import('../src/store/db.ts');
  const { settings } = await import('../src/settings.ts');
  const db = openCoreDb();
  const id = `typed-${randomUUID()}`;
  const marker = `PRIVATE_${randomUUID().replaceAll('-', '')}`;
  const at = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('typed-project', home.home, 'typed', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, 1, ?)').run('typed-engine', '{}', 'local-cli');
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'typed-project', 'typed-engine', 'pty', 'working', ?, ?)").run(id, at, at);
  events.wireTermEvents(db);
  const echo = "process.stdin.setRawMode&&process.stdin.setRawMode(true);process.stdout.write('READY> ');process.stdin.on('data',(d)=>process.stdout.write(d+'\x1b]0;'+d+'\x07'))";
  term.open(id, [process.execPath, '-e', echo], home.home, process.env);
  try {
    await until(async () => (await term.snapshot(id))?.includes('READY>'));
    term.write(id, marker);
    await until(async () => (await term.snapshot(id))?.includes(marker));
    await sleep(settings().terminal.last_line_every_ms + 500);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
    const hits = tables.filter(({ name }) => JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all()).includes(marker)).map(({ name }) => name);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    hits.push(...files(home.home).filter((f) => readFileSync(f).includes(marker)));
    assert.deepEqual(hits, []);
    assert.ok(events.liveText()[id]?.line?.includes(marker), JSON.stringify(events.liveText()[id]));
    assert.ok(events.liveText()[id]?.title?.includes(marker), JSON.stringify(events.liveText()[id]));
  } finally {
    term.kill(id);
    await until(() => !term.has(id));
    db.close();
  }
});
