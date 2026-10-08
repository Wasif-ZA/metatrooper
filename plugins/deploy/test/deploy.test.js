import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('M4-07 F3 deploy extracts a URL followed by punctuation', { skip: process.platform === 'win32' ? 'Windows shell lookup for temporary vercel shim is unavailable in this test environment.' : false }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'metatrooper-deploy-'));
  try {
    const project = join(dir, 'project');
    const bin = join(dir, 'bin');
    mkdirSync(join(project, '.vercel'), { recursive: true });
    mkdirSync(bin);
    writeFileSync(join(project, '.vercel', 'project.json'), '{}');
    const vercel = join(bin, 'vercel');
    writeFileSync(vercel, '#!/bin/sh\nprintf "%s\\n" "https://preview.example/path.,"\n');
    execFileSync('chmod', ['+x', vercel]);
    const searchPath = `${bin}:${process.env.PATH ?? ''}`;
    const output = execFileSync(process.execPath, [join(root, 'bin', 'deploy.js'), 'preview'], {
      cwd: dir,
      env: { ...process.env, PATH: searchPath, Path: searchPath, TROOP_PROJECT_DIR: project },
      input: JSON.stringify({ project }),
      encoding: 'utf8',
    });
    const result = JSON.parse(output);
    assert.equal(result.ok, true, output);
    assert.equal(result.outputs.url, 'https://preview.example/path.,');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
