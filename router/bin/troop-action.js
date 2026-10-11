#!/usr/bin/env node
// MetaTrooper plugin action: reads the action request on stdin, answers {"ok", "outputs"} on stdout.
import fs from 'node:fs';
import { run } from './metarouter.js';

const fail = (message) => { process.stdout.write(JSON.stringify({ ok: false, error: { message, retryable: false } })); process.exitCode = 1; };

let req;
try { req = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { req = {}; }
const input = req.input ?? {};

if (req.action !== 'ingest') fail(`unknown action ${req.action}`);
else {
  const args = ['ingest', '--no-save', '--json'];
  if (typeof input.since === 'string') args.push('--since', input.since);
  if (typeof input.until === 'string') args.push('--until', input.until);
  const r = run(args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  let out;
  try { out = JSON.parse(String(r.stdout ?? '').trim()); } catch { out = null; }
  if (r.status === 127) fail('metarouter needs Python 3.11 or later; set TROOP_PYTHON to its path');
  else if (!out || out.ok !== true) fail(out?.error ?? out?.note ?? `metarouter ingest exited ${r.status}`);
  else {
    const { ok, exit, ...outputs } = out;
    process.stdout.write(JSON.stringify({ ok: true, outputs }));
  }
}
