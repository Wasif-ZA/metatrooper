import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('a DPAPI secret reads back byte for byte: non-ASCII and edge whitespace survive', { skip: process.platform !== 'win32' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-secret-'));
  process.env.METATROOPER_HOME = home;
  try {
    const writer = await import('../src/secrets.ts?writer');
    const reader = await import('../src/secrets.ts?reader');
    for (const [i, value] of [' pässwörd-日本-€ x ', 'ends in a newline\n'].entries()) {
      writer.setSecret(new DatabaseSync(':memory:'), 'core-notify', `SINK_t${i}`, value);
      assert.equal(reader.getSecret('core-notify', `SINK_t${i}`), value);
    }
    fs.writeFileSync(writer.secretPath('core-notify', 'SINK_bad'), 'not a blob');
    assert.throws(() => reader.getSecret('core-notify', 'SINK_bad'), /powershell failed/);
  } finally {
    delete process.env.METATROOPER_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
