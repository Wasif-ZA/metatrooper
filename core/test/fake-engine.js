import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const prompt = process.argv[2] ?? '';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function directive() {
  const line = prompt.split(/\r?\n/).find(value => value.startsWith('FAKE '));
  if (!line) return {};
  try { return JSON.parse(line.slice(5)); }
  catch { return {}; }
}

function outputPath() {
  const match = /^When you are done, write your result to:\s*(.+)$/m.exec(prompt);
  return match?.[1]?.trim() ?? null;
}

function requiredOutputs() {
  const match = /^Start that file with a front matter block containing these keys:\s*(.*?)\s*and status:/m.exec(prompt);
  if (!match) return [];
  return match[1].split(',').map(value => value.trim()).filter(Boolean);
}

function scalar(value) {
  return JSON.stringify(value);
}

function stepId(file) {
  return basename(file, '.md').replace(/-\d+$/, '');
}

function incrementAttempt(file) {
  const counter = join(dirname(file), `.fake-engine-${basename(file, '.md')}.json`);
  let attempt = 0;
  try { attempt = JSON.parse(readFileSync(counter, 'utf8')).attempt; }
  catch {}
  attempt += 1;
  writeFileSync(counter, JSON.stringify({ attempt }));
  return attempt;
}

function recordUsage(file, tokens) {
  const home = process.env.METATROOPER_HOME;
  const session = process.env.TROOP_SESSION_ID;
  if (!home || !session || !Number.isFinite(tokens) || tokens <= 0) return;
  const runDir = dirname(file);
  const runId = basename(runDir);
  const step = stepId(file);
  let db;
  try {
    db = new DatabaseSync(join(home, 'troop.db'));
    db.exec('PRAGMA busy_timeout = 2000');
    db.prepare(
      `INSERT OR IGNORE INTO usage (at, run_id, step_id, session_id, engine_id, provider, tokens_in, tokens_out, cache_read, cache_write, usd, source, dedupe_key)
       VALUES (?, ?, ?, ?, 'fake', 'local-cli', ?, 0, 0, 0, 0, 'unknown', ?)`,
    ).run(new Date().toISOString(), runId, step, session, Math.floor(tokens), `${session}:${step}:${Date.now()}`);
  } catch {
  } finally {
    try { db?.close(); } catch {}
  }
}

function emitStop() {
  if (!process.env.TROOP_SESSION_ID) return;
  spawnSync(process.execPath, [join(import.meta.dirname, '..', 'event.js'), 'claude.Stop'], {
    env: process.env,
    input: JSON.stringify({ stop_hook_active: false }),
    stdio: ['pipe', 'ignore', 'ignore'],
    windowsHide: true,
  });
}

async function main() {
  const out = outputPath();
  if (!out) {
    await sleep(1000);
    return;
  }
  const spec = directive();
  if (Number.isFinite(spec.delay_ms) && spec.delay_ms > 0) await sleep(spec.delay_ms);
  mkdirSync(dirname(out), { recursive: true });
  const attempt = incrementAttempt(out);
  const status = attempt <= Number(spec.fail_until ?? 0) ? 'failed' : String(spec.status ?? 'done');
  const values = { ...(spec.outputs ?? {}) };
  for (const key of requiredOutputs()) if (!(key in values)) values[key] = key === 'passed' ? true : `${key}-${attempt}`;
  const lines = ['---', `status: ${scalar(status)}`];
  for (const [key, value] of Object.entries(values)) lines.push(`${key}: ${scalar(value)}`);
  lines.push('---', '', `fake engine attempt ${attempt}`);
  writeFileSync(out, lines.join('\n') + '\n');
  recordUsage(out, Number(spec.usage_tokens ?? 0));
  emitStop();
}

main().catch(() => process.exit(1));
