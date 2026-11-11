import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.ts';
import type { DatabaseSync } from 'node:sqlite';
import type { EngineSpec } from '../src/engines/registry.ts';
import { launchSession } from '../src/sessions/launch.ts';

function insertedPrompt(prompt: string | undefined): unknown {
  let captured: { sql: string; params: unknown[] } | undefined;
  const fakeDb = {
    prepare(sql: string) {
      return {
        run(...params: unknown[]) {
          if (sql.includes('INSERT INTO session ')) { captured = { sql, params }; throw new Error('STOP'); }
          return { changes: 1 };
        },
        get() { return undefined; },
        all() { return []; },
      };
    },
    exec() {},
  };
  const engine = { id: 'fake-engine', command: 'node', cost_rank: 1, roles: ['worker'] } as unknown as EngineSpec;
  assert.throws(() => launchSession(fakeDb as unknown as DatabaseSync, { projectId: 'p1', projectPath: '/path/p1', projectName: 'p1', engine, prompt }), /STOP/);
  const cols = captured!.sql.slice(captured!.sql.indexOf('(') + 1, captured!.sql.indexOf(')')).split(',').map((c) => c.trim());
  return captured!.params[cols.indexOf('prompt')];
}

test('launchSession stores the task it was given in session.prompt', () => {
  assert.equal(insertedPrompt('fix the login bug'), 'fix the login bug');
});

test('launchSession stores null when no task was given', () => {
  assert.equal(insertedPrompt(undefined), null);
  assert.equal(insertedPrompt(''), null);
});
