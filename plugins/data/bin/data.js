import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

function columnNames(header) {
  const used = new Set();
  return header.map((h, i) => {
    const base = h.trim() || `column_${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}_${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

export function load(input) {
  const [header, ...body] = parseCsv(fs.readFileSync(input.path, 'utf8'));
  if (!header) throw new Error(`${input.path} is empty`);
  const columns = columnNames(header);
  const table = input.table || 'raw';
  fs.mkdirSync(path.dirname(input.db), { recursive: true });
  const db = new DatabaseSync(input.db);
  try {
    db.exec(`DROP TABLE IF EXISTS ${ident(table)}; CREATE TABLE ${ident(table)} (${columns.map((c) => `${ident(c)} TEXT`).join(', ')})`);
    const insert = db.prepare(`INSERT INTO ${ident(table)} VALUES (${columns.map(() => '?').join(', ')})`);
    const ragged = [];
    db.exec('BEGIN');
    body.forEach((r, i) => {
      if (r.length !== columns.length) ragged.push(i + 2);
      insert.run(...columns.map((_, j) => r[j] ?? null));
    });
    db.exec('COMMIT');
    return { db: input.db, table, rows: body.length, columns, ragged_lines: ragged.slice(0, 50), ragged: ragged.length };
  } finally {
    db.close();
  }
}

function select(dbPath, sql, limit = 1000) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    return { columns: stmt.columns().map((c) => c.name), rows: rows.slice(0, limit), total: rows.length, truncated: rows.length > limit };
  } finally {
    db.close();
  }
}

export function query(input) {
  const result = select(input.db, input.sql, input.limit);
  if (input.out) fs.writeFileSync(input.out, JSON.stringify(result, null, 2));
  return input.out ? { out: input.out, total: result.total, columns: result.columns } : result;
}

export function kpiBlocks(markdown) {
  const blocks = [];
  let heading = null;
  for (const m of markdown.matchAll(/^#{2,4}\s+(.+)$|^```sql\s*\n([\s\S]*?)^```/gim)) {
    if (m[1]) heading = m[1].trim();
    else blocks.push({ name: heading ?? `KPI ${blocks.length + 1}`, sql: m[2].trim() });
  }
  return blocks;
}

export function render(input) {
  const kpis = kpiBlocks(fs.readFileSync(input.spec, 'utf8')).map((k) => {
    try {
      const r = select(input.db, k.sql, 500);
      const first = r.rows[0];
      return { ...k, columns: r.columns, rows: r.rows, value: r.total === 1 && r.columns.length === 1 ? first[r.columns[0]] : null };
    } catch (e) {
      return { ...k, error: e instanceof Error ? e.message : String(e) };
    }
  });
  if (!kpis.length) throw new Error(`${input.spec} has no sql blocks`);
  const out = input.out || path.join(path.dirname(input.spec), 'kpis.json');
  fs.writeFileSync(out, JSON.stringify(kpis, null, 2));
  return { out, kpis: kpis.length, failed: kpis.filter((k) => k.error).map((k) => k.name) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const req = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const fn = { load, query, render }[process.argv[2]];
    if (!fn) throw new Error(`unknown action ${process.argv[2]}`);
    process.stdout.write(JSON.stringify({ ok: true, outputs: fn(req.input || {}) }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: { message: e instanceof Error ? e.message : String(e), retryable: false } }));
  }
}
