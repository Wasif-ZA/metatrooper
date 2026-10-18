import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runNode } from './helpers.ts';

for (const [name, home] of [['METATROOPER_HOME unset', null], ['METATROOPER_HOME inside the real data folder', 'inside']] as const) {
  test(`M6-16b a --demo core with ${name} exits 2 before it writes anything`, { timeout: 30_000 }, async (t) => {
    // protects=the core's own demo isolation check, run before the log, DB or pipe fails_when=a --demo core starts against the real home or writes there first no_claim=the workbench's generated env
    const fake = mkdtempSync(join(tmpdir(), 'metatrooper-fakeuser-'));
    t.after(() => rmSync(fake, { recursive: true, force: true }));
    const real = join(fake, '.metatrooper');
    mkdirSync(real);
    const env: Record<string, string | undefined> = { ...process.env, USERPROFILE: fake, HOME: fake, METATROOPER_PIPE_PREFIX: `troop-test-${randomUUID().replaceAll('-', '')}` };
    if (home) env.METATROOPER_HOME = join(real, 'demo'); else delete env.METATROOPER_HOME;
    const r = await runNode(['core/src/main.ts', '--demo'], env) as { code: number; stderr: string };
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, home ? /refused: demo would use the real data folder/ : /refused: demo needs METATROOPER_HOME and METATROOPER_PIPE_PREFIX/);
    assert.deepEqual(readdirSync(real), []);
  });
}
