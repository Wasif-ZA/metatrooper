import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { ISSUE_PREFIX, MAX_URL, cleanReport, localIso, issueUrl } from '../src/report-issue.ts';

test('issueUrl always starts with the exact ISSUE_PREFIX', () => {
  assert.equal(ISSUE_PREFIX, 'https://github.com/Wasif-ZA/metatrooper-private/issues/new?');
  const url = issueUrl({
    version: '1.0.0',
    commit: 'a1b2c3d',
    view: 'Wall',
    project: 'alpha',
    os: 'Linux 6.0 x64',
    time: '2026-11-10T12:00+00:00',
    errors: [],
  });
  assert.ok(url.startsWith(ISSUE_PREFIX));
});

test('issueUrl title decodes to Ouros: <view> and defaults to unknown', () => {
  for (const [view, expected] of [
    ['Home', 'Ouros: Home'],
    ['IDE', 'Ouros: IDE'],
    ['Wall', 'Ouros: Wall'],
    ['Settings', 'Ouros: Settings'],
    ['', 'Ouros: unknown'],
    ['   ', 'Ouros: unknown'],
  ]) {
    const cleaned = cleanReport({ view, project: 'p', errors: [] });
    const url = issueUrl({
      version: '1.0.0',
      commit: 'abc',
      view: cleaned.view,
      project: cleaned.project,
      os: 'Linux',
      time: '2026-11-10T12:00+00:00',
      errors: [],
    });
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('title'), expected);
  }
});

test('cleanReport reduces project to its last path segment and handles empty', () => {
  for (const [input, expected] of [
    ['alpha', 'alpha'],
    ['/home/user/code/ouros', 'ouros'],
    ['C:\\Users\\User\\Workspace\\ouros-project', 'ouros-project'],
    ['/var/repo/trailing/', 'trailing'],
    ['D:\\code\\trailing-slash\\', 'trailing-slash'],
    ['', ''],
    [null, ''],
    [undefined, ''],
    [123, ''],
  ]) {
    assert.equal(cleanReport({ project: input }).project, expected);
  }
  const withProject = issueUrl({
    version: '1.0.0',
    commit: '',
    view: 'Wall',
    project: 'my-proj',
    os: 'Linux',
    time: '2026-11-10T12:00+00:00',
    errors: [],
  });
  assert.ok(decodeURIComponent(withProject).includes('- Project: my-proj'));
  const noProject = issueUrl({
    version: '1.0.0',
    commit: '',
    view: 'Wall',
    project: '',
    os: 'Linux',
    time: '2026-11-10T12:00+00:00',
    errors: [],
  });
  assert.ok(decodeURIComponent(noProject).includes('- Project: none'));
});

test('cleanReport and issueUrl strip newlines from fields', () => {
  const cleaned = cleanReport({
    view: 'Multi\r\nLine\nView',
    project: '/root/path/\r\nmulti\nproject',
    errors: ['first\r\nerror', 'second\nerror'],
  });
  assert.equal(cleaned.view, 'Multi Line View');
  assert.equal(cleaned.project, 'multi project');
  assert.deepEqual(cleaned.errors, ['first error', 'second error']);

  const url = issueUrl({
    version: '1.0.0',
    commit: 'abc',
    view: cleaned.view,
    project: cleaned.project,
    os: 'Linux',
    time: '2026-11-10T12:00+00:00',
    errors: cleaned.errors,
  });
  const decoded = decodeURIComponent(url);
  assert.ok(decoded.includes('- View: Multi Line View'));
  assert.ok(decoded.includes('- Project: multi project'));
  assert.ok(decoded.includes('first error'));
  assert.ok(decoded.includes('second error'));
});

test('cleanReport drops extra fields and unlisted renderer properties', () => {
  const cleaned = cleanReport({
    view: 'Home',
    project: 'alpha',
    errors: ['e1'],
    url: 'https://evil.com/override',
    token: 'secret-token-123',
    env: { SECRET: 'val' },
    extraKey: 42,
  });
  assert.deepEqual(cleaned, { view: 'Home', project: 'alpha', errors: ['e1'] });
  assert.equal((cleaned as Record<string, unknown>).url, undefined);
  assert.equal((cleaned as Record<string, unknown>).token, undefined);

  for (const nonObj of [null, undefined, 42, 'raw string', true]) {
    assert.deepEqual(cleanReport(nonObj), { view: 'unknown', project: '', errors: [] });
  }
});

test('7500-char cap drops oldest errors first and reports how many were cut', () => {
  const errors = Array.from({ length: 20 }, (_, i) => `Error #${i + 1}: ${'a<>&"\''.repeat(40)} (file-${i}.js:${i * 10})`);
  const facts = {
    version: '1.0.0',
    commit: 'fedcba9',
    view: 'IDE',
    project: 'workspace',
    os: 'Linux 6.0 x64',
    time: '2026-11-10T12:00+00:00',
    errors,
  };
  const url = issueUrl(facts);
  assert.ok(url.length <= MAX_URL, `URL length ${url.length} exceeds MAX_URL ${MAX_URL}`);

  const decoded = decodeURIComponent(url);
  const match = /## Recent console errors \((\d+), (\d+) older cut for length\)/.exec(decoded);
  assert.ok(match, 'cut count heading must exist in body');
  const keptCount = Number(match[1]);
  const droppedCount = Number(match[2]);
  assert.equal(keptCount + droppedCount, 20);
  assert.ok(droppedCount > 0, 'at least one error was dropped to stay under limit');

  for (let i = 0; i < droppedCount; i++) {
    assert.ok(!decoded.includes(`Error #${i + 1}:`), `oldest error #${i + 1} should have been dropped`);
  }
  for (let i = droppedCount; i < 20; i++) {
    assert.ok(decoded.includes(`Error #${i + 1}:`), `newest error #${i + 1} should be preserved`);
  }
});

test('hostile view or project cannot change URL host, path, or protocol', () => {
  const attacks = [
    'https://evil.com/steal',
    '//evil.com/leak',
    '@evil.com/hack',
    'javascript:alert(1)',
    'data:text/html,evil',
    '../../../../etc/passwd',
    '\\\\evil-server\\share',
    'test#anchor?foo=bar',
    '?redirect=https://evil.com',
  ];
  for (const hostile of attacks) {
    const cleaned = cleanReport({ view: hostile, project: hostile, errors: [hostile] });
    const url = issueUrl({
      version: '1.0.0',
      commit: 'abc1234',
      view: cleaned.view,
      project: cleaned.project,
      os: 'Linux',
      time: '2026-11-10T12:00+00:00',
      errors: cleaned.errors,
    });
    assert.ok(url.startsWith(ISSUE_PREFIX));
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'https:');
    assert.equal(parsed.host, 'github.com');
    assert.equal(parsed.pathname, '/Wasif-ZA/metatrooper-private/issues/new');
  }
});

test('localIso formats local time with offset and no seconds', () => {
  const iso = localIso();
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test('main reportIssue handler refuses a URL without ISSUE_PREFIX and opens valid URL', async () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const start = main.indexOf("on('reportIssue', ");
  assert.ok(start >= 0, 'reportIssue IPC handler exists in main.ts');
  const body = main.slice(start + 'reportIssue'.length + 7).split('\n  });')[0];

  const opened: string[] = [];
  const validShell = { openExternal: async (url: string) => { opened.push(url); } };
  const mockApp = { getAppPath: () => '/synthetic', getVersion: () => '1.0.0' };
  const mockOs = { type: () => 'Linux', release: () => '6.0', arch: () => 'x64' };

  const validHandler = vm.runInNewContext(stripTypeScriptTypes('(' + body + '\n  })'), {
    cleanReport,
    issueUrl,
    localIso,
    ISSUE_PREFIX,
    execFileSync: () => 'abc1234\n',
    app: mockApp,
    os: mockOs,
    shell: validShell,
  });

  const okResult = await validHandler({ view: 'Wall', project: 'demo', errors: [] });
  assert.equal(okResult, true);
  assert.equal(opened.length, 1);
  assert.ok(opened[0].startsWith(ISSUE_PREFIX));

  let forgedUrl = 'https://attacker.example.com/malicious';
  const refusingHandler = vm.runInNewContext(stripTypeScriptTypes('(' + body + '\n  })'), {
    cleanReport,
    issueUrl: () => forgedUrl,
    localIso,
    ISSUE_PREFIX,
    execFileSync: () => 'abc1234\n',
    app: mockApp,
    os: mockOs,
    shell: validShell,
  });

  opened.length = 0;
  const badResult1 = await refusingHandler({ view: 'Wall', project: 'demo', errors: [] });
  assert.equal(badResult1, false);
  assert.equal(opened.length, 0);

  forgedUrl = 'javascript:alert(1)';
  const badResult2 = await refusingHandler({ view: 'Wall', project: 'demo', errors: [] });
  assert.equal(badResult2, false);
  assert.equal(opened.length, 0);
});
