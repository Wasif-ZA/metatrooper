import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('inbox labels folder trust only for a trust wait and includes cwd in its detail', () => {
  // protects=trust-specific inbox row wording and folder context in the detail question
  const source = read('../ui/src/inbox.jsx');
  assert.match(source, /isSession\s*&&\s*row\.reason\s*===\s*'trust'\s*\?\s*'asks to trust this folder'/);
  assert.match(source, /item\.reason\s*===\s*'trust'\s*\?\s*trustQuestion\(item\)/);
  const question = source.match(/const trustQuestion = \(x\) => ([^;]+);/);
  assert.ok(question, 'extract the actual detail question');
  assert.ok(question[1].includes('`Trust this folder? ${x.cwd'));
  const trustQuestion = runInNewContext(`(x) => ${question[1]}`);
  assert.equal(trustQuestion({ cwd: 'C:/work/project' }), 'Trust this folder? C:/work/project');
  assert.equal(trustQuestion({}), 'Trust this folder?');
});

test('renderer waitReason gives trust its human-readable question', () => {
  // protects=trust reason rendering while preserving permission and ordinary question fallbacks
  const source = read('../renderer/app.js');
  const fn = source.match(/function waitReason\(x\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, 'extract the actual renderer function');
  const waitReason = runInNewContext(`(${fn[0]})`);
  assert.equal(waitReason({ reason: 'trust', last_tool: 'Bash' }), 'trust this folder?');
  assert.equal(waitReason({ reason: 'permission' }), 'permission');
  assert.equal(waitReason({ last_tool: 'Bash' }), 'permission: Bash');
  assert.equal(waitReason({}), 'question');
});

test('session and live snapshot queries carry the wait reason and working folder', () => {
  // protects=both workbench session collections expose wait_reason as reason together with cwd
  const source = read('../src/queries.ts');
  assert.match(source, /const reason = [^;]*'s\.wait_reason AS reason'/);
  const sessions = source.match(/const sessions = projectId\s*\?\s*\(db\.prepare\(\s*`([\s\S]*?)`,/);
  const live = source.match(/live:\s*\(db\.prepare\(`([\s\S]*?)`\)/);
  assert.ok(sessions, 'sessions query exists');
  assert.ok(live, 'live query exists');
  assert.ok(sessions[1].includes('${reason}'));
  assert.match(sessions[1], /\bs\.cwd\b/);
  assert.match(live[1], /wait_reason AS reason/);
  assert.match(live[1], /\bcwd\b/);
});
