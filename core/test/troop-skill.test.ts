import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skill = readFileSync(new URL('../../skills/troop/SKILL.md', import.meta.url), 'utf8');
const cli = readFileSync(new URL('../cli.ts', import.meta.url), 'utf8');

test('M1-31 troop skill file documents the run commands the CLI implements', () => {
  assert.match(skill, /^---\nname: troop\n/);
  for (const cmd of ['run start', 'run wait', 'run status']) {
    assert.ok(skill.includes(`troop ${cmd}`), `skill mentions ${cmd}`);
    assert.ok(cli.includes(`${cmd} `), `cli implements ${cmd}`);
  }
  assert.match(skill, /two-engine-review/);
  assert.match(skill, /--json/);
});
