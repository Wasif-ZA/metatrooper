import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { textOf } from '../../plugins/gmail/bin/gmail.js';
import { ingest } from '../../plugins/docs-export/bin/docs-export.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'm5-21-'));
const b64 = (s: string) => Buffer.from(s).toString('base64');

test('form-fill-batch submit marks missing recorded window as failed', { skip: 'desktop.ps1 requires a real Windows desktop session' }, () => {
  const script = fileURLToPath(new URL('../../plugins/desktop/bin/desktop.ps1', import.meta.url));
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'rows.json'), JSON.stringify([{ window: 'window-that-does-not-exist' }]));
    const r = spawnSync('powershell.exe', ['-NoProfile', '-File', script], { input: JSON.stringify({ action: 'submit', input: { rows: join(dir, 'rows.json') } }), encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('form-fill-batch read reports missing recorded window as a failed row', { skip: 'desktop.ps1 requires a real Windows desktop session' }, () => {
  const script = fileURLToPath(new URL('../../plugins/desktop/bin/desktop.ps1', import.meta.url));
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'rows.json'), JSON.stringify([{ values: { a: 1 } }]));
    const r = spawnSync('powershell.exe', ['-NoProfile', '-File', script], { input: JSON.stringify({ action: 'read', input: { rows: join(dir, 'rows.json') } }), encoding: 'utf8' });
    assert.equal(r.status, 0);
    const result = JSON.parse(r.stdout);
    assert.equal(result.failed, 1);
    assert.equal(result.errors.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('prospect CSV with E-mail header keeps no prospects', async () => {
  const { run } = await import('../../pipelines/unshipped/prospect-list-to-drafts/load.mjs');
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'prospects.csv'), 'E-mail,name\na@example.com,A\n');
    await assert.rejects(run({ projectPath: dir, inputs: { list: 'prospects.csv' }, writeFile: async () => {} }), /no prospect kept/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('agent-reach sources rejects when every site fetch fails', async () => {
  const { sources } = await import('../../plugins/agent-reach/bin/search.js');
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'prospects.json'), JSON.stringify([{ name: 'A', site: 'https://example.com' }]));
    await assert.rejects(sources({ prospects: join(dir, 'prospects.json'), out: join(dir, 'sources') }, async () => { throw new Error('offline'); }), /no site could be fetched/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('gmail textOf ignores head style and returns visible text', () => {
  assert.equal(textOf({ mimeType: 'text/html', body: { data: b64('<head><style>.a{color:red}</style></head><p>Pay by Friday</p>') } }), 'Pay by Friday');
});

test('inbox-triage-drafts approve gate says when the rules file was not found', async () => {
  const pipeline = JSON.parse(fs.readFileSync(new URL('../../pipelines/unshipped/inbox-triage-drafts.json', import.meta.url), 'utf8'));
  const gate = pipeline.steps.find((step: any) => step.id === 'approve');
  assert.match(gate.gate_summary, /Rules file found: \{\{steps\.rules\.outputs\.found\}\}/);
  const { run } = await import('../../pipelines/unshipped/inbox-triage-drafts/rules.mjs');
  const dir = tmp();
  try {
    const out = await run({ inputs: { rules: join(dir, 'missing-rules.md') }, runDir: dir, projectPath: dir, writeFile: async () => {}, log: () => {} });
    assert.equal(out.found, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('docs-export ingest rejects a PDF without a text layer', () => {
  const dir = tmp();
  const pdf = join(dir, 'blank.pdf');
  try {
    writeFileSync(pdf, '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF');
    assert.throws(() => ingest({ path: pdf, out: join(dir, 'out') }), /no text in/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('study-notes signoff gate names passed check and unsourced lines', () => {
  const pipeline = JSON.parse(fs.readFileSync(new URL('../../pipelines/unshipped/study-notes-to-pdf.json', import.meta.url), 'utf8'));
  const gate = pipeline.steps.find((step: any) => step.id === 'signoff');
  assert.match(gate.gate_summary, /Check passed: \{\{steps\.check\.outputs\.passed\}\}/);
  assert.match(gate.gate_summary, /unsourced lines left: \{\{steps\.check\.outputs\.unsourced\}\}/);
});
