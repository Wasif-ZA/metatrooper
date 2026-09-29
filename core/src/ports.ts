import net from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import { nowIso } from './time.ts';

const FIRST = 3001;
const LAST = 3999;

function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (v: boolean) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(200, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

/** Leases the lowest port at or above 3001 that has no lease and nothing listening on it. */
export async function leasePort(db: DatabaseSync, runId: string, idx: number): Promise<number> {
  for (let port = FIRST; port <= LAST; port++) {
    const taken = db.prepare('SELECT 1 FROM port_lease WHERE port = ?').get(port);
    if (taken) continue;
    if (await listening(port)) continue;
    const r = db.prepare('INSERT OR IGNORE INTO port_lease (port, run_id, idx, leased_at) VALUES (?, ?, ?, ?)').run(port, runId, idx, nowIso());
    if (Number(r.changes) === 1) return port;
  }
  throw new Error(`no free port between ${FIRST} and ${LAST}`);
}

export function releasePorts(db: DatabaseSync, runId: string, idx?: number): void {
  if (idx === undefined) db.prepare('DELETE FROM port_lease WHERE run_id = ?').run(runId);
  else db.prepare('DELETE FROM port_lease WHERE run_id = ? AND idx = ?').run(runId, idx);
}
