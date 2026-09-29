import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { homeDir } from './paths.ts';
import { ulid } from './time.ts';
import { E, RpcError } from './pipe/errors.ts';

export const BOARD_ACTION = { plugin: 'agent-reach', action: 'inspiration-board' };

export interface Reference {
  source_url: string;
  title?: string;
  reason: string;
  kind?: string;
}

export interface BoardItem {
  id: string;
  run_id: string;
  source_url: string;
  capture_path: string | null;
  reason: string;
  pinned: number;
  removed: number;
}

export type BoardCapture = (req: { project_id: string; url: string; out_path: string }) => Promise<unknown>;

export function boardDir(runId: string): string {
  return path.join(homeDir(), 'boards', runId);
}

/** Reads the references out of an inspiration-board action's outputs, keeping only http(s) URLs with a reason. */
export function referencesOf(outputs: Record<string, unknown>): Reference[] {
  const list = Array.isArray(outputs.references) ? outputs.references : [];
  return list.filter((r): r is Reference =>
    !!r && typeof r === 'object' && typeof (r as Reference).source_url === 'string' && /^https?:\/\//i.test((r as Reference).source_url) && typeof (r as Reference).reason === 'string');
}

export function recordBoard(db: DatabaseSync, runId: string, refs: Reference[]): BoardItem[] {
  const insert = db.prepare('INSERT INTO board_item (id, run_id, source_url, capture_path, reason, pinned, removed) VALUES (?, ?, ?, NULL, ?, 0, 0)');
  return refs.map((r) => {
    const id = ulid();
    insert.run(id, runId, r.source_url, r.reason);
    return { id, run_id: runId, source_url: r.source_url, capture_path: null, reason: r.reason, pinned: 0, removed: 0 };
  });
}

/** Captures each item's first screen through the workbench, three at a time; returns the count captured and one message per failure. */
export async function captureBoard(db: DatabaseSync, projectId: string, items: BoardItem[], capture: BoardCapture): Promise<{ captured: number; failures: string[] }> {
  const dir = boardDir(items[0]?.run_id ?? 'none');
  fs.mkdirSync(dir, { recursive: true });
  const set = db.prepare('UPDATE board_item SET capture_path = ? WHERE id = ?');
  const failures: string[] = [];
  let captured = 0;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      const out = path.join(dir, `${item.id}.png`);
      try {
        await capture({ project_id: projectId, url: item.source_url, out_path: out });
        if (!fs.existsSync(out)) throw new Error('no image written');
        set.run(out, item.id);
        item.capture_path = out;
        captured++;
      } catch (e) {
        failures.push(`${item.source_url}: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker));
  return { captured, failures };
}

export function listBoard(db: DatabaseSync, runId: string): BoardItem[] {
  return db.prepare('SELECT id, run_id, source_url, capture_path, reason, pinned, removed FROM board_item WHERE run_id = ? ORDER BY rowid').all(runId) as unknown as BoardItem[];
}

export function setBoardFlag(db: DatabaseSync, itemId: string, flag: 'pinned' | 'removed', value: boolean): void {
  const r = db.prepare(`UPDATE board_item SET ${flag} = ? WHERE id = ?`).run(value ? 1 : 0, itemId);
  if (Number(r.changes) === 0) throw new RpcError(E.NOT_FOUND, 'board item not found');
}
