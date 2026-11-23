import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { block } from '../gen-methods.ts';
import { METHODS, methodTable } from '../src/methods.ts';

const launch = METHODS.find((method) => method.name === 'session.launch')!;
const contract = readFileSync(new URL('../../contracts/pipe-protocol.md', import.meta.url), 'utf8');
const launchRow = contract.split('\n').find((line) => line.startsWith('| `session.launch` |'));

test('FIX-C10a: METHODS documents launch approval, host and result fields', () => {
  assert.ok(launch, 'session.launch must be declared');
  assert.match(launch.params, /\bapproval\?:/);
  assert.match(launch.params, /\bhost\?: "pty"\|"sandbox"/);
  const fields = launch.result.match(/^\{([^}]+)\}/)![1].split(',').map((field) => field.trim());
  assert.ok(fields.includes('approval'), 'approval must be a required result field');
  assert.ok(fields.includes('setup?'), 'setup must be an optional result field');
});

test('FIX-C10a: documented result fields cover every launchSession return key', () => {
  const source = readFileSync(new URL('../src/sessions/launch.ts', import.meta.url), 'utf8');
  const returned = source.match(/^\s*return (\{ session_id:[^\n]+\});\s*$/m);
  assert.ok(returned, 'locate the launchSession return object');
  // Include shorthand properties inside the conditional setup spread as well.
  const keys = [...returned[1].matchAll(/[{,]\s*(\w+)\s*(?=:|[,}])/g)].map((match) => match[1]);
  assert.ok(keys.includes('approval'), 'launchSession must return approval');
  assert.ok(keys.includes('setup'), 'include the conditional setup return key');
  const fields = launch.result.match(/^\{([^}]+)\}/)![1].split(',').map((field) => field.trim().replace(/\?$/, ''));
  for (const key of keys) assert.ok(fields.includes(key), `METHODS result is missing ${key}`);
});

test('FIX-C10b: generated pipe contract matches METHODS without regeneration changes', () => {
  const generated = methodTable();
  assert.ok(launchRow, 'session.launch contract row must exist');
  assert.equal(launchRow, generated.split('\n').find((line) => line.startsWith('| `session.launch` |')));
  assert.equal(block(contract), generated, 'regenerating the pipe contract must produce no diff');
});

test('FIX-C10c: contract documents session_secret approval rejection and omission cap', () => {
  assert.ok(launchRow, 'session.launch contract row must exist');
  for (const text of [launch.result, launchRow]) {
    assert.match(text, /`session_secret`[^\n]*proves the calling session on a non-UI connection/);
    assert.match(text, /child cannot run looser than that session \(a looser `approval` fails with -32012; an omitted one is capped\)/);
  }
});
