import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { rankFiles } from '../src/files.ts';

test('disc ranks file prefixes before file substrings', () => {
  assert.deepEqual(rankFiles(['src/discount.js', 'src/total.js', 'test/discount.test.js', 'docs/about-discounts.md', 'README.md'], 'disc'), ['src/discount.js', 'test/discount.test.js', 'docs/about-discounts.md']);
});

test('TOTAL ignores case and ranks file matches before folder matches', () => {
  assert.deepEqual(rankFiles(['src/cart/total.js', 'src/total.js', 'total/readme.md'], 'TOTAL'), ['src/total.js', 'src/cart/total.js', 'total/readme.md']);
});

test('all query words must match across the whole path', () => {
  assert.deepEqual(rankFiles(['src/cart/total.js', 'src/total.js'], 'total cart'), ['src/cart/total.js']);
  assert.deepEqual(rankFiles(['SRC/Cart/TOTAL.js', 'src/total.js', 'cart/other.js'], '  ToTaL   CART  '), ['SRC/Cart/TOTAL.js']);
});

test('empty and all-space queries return no paths', () => {
  assert.deepEqual(rankFiles(['src/cart.js'], ''), []);
  assert.deepEqual(rankFiles(['src/cart.js'], '    '), []);
  assert.deepEqual(rankFiles([], 'cart'), []);
  assert.deepEqual(rankFiles(['src/cart.js'], 'missing'), []);
});

test('groups outrank length and ties use path length then name', () => {
  const paths = ['x/r.md', 'r/z.md', 'very/long/r.js', 'b/r.js', 'a/r.js', 'xr.md', 'r.md'];
  assert.deepEqual(rankFiles(paths, 'r'), ['r.md', 'a/r.js', 'b/r.js', 'x/r.md', 'very/long/r.js', 'xr.md', 'r/z.md']);
  assert.deepEqual(paths, ['x/r.md', 'r/z.md', 'very/long/r.js', 'b/r.js', 'a/r.js', 'xr.md', 'r.md']);
});

test('explicit limits truncate the ranked results including zero', () => {
  assert.deepEqual(rankFiles(['r/z.md', 'b/r.js', 'a/r.js', 'r.md'], 'r', 2), ['r.md', 'a/r.js']);
  assert.deepEqual(rankFiles(['r.md'], 'r', 0), []);
  assert.deepEqual(rankFiles(['r.md'], 'r', 5), ['r.md']);
});

test('default limit returns the first 50 literal paths', () => {
  const paths = ['r00', 'r01', 'r02', 'r03', 'r04', 'r05', 'r06', 'r07', 'r08', 'r09', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15', 'r16', 'r17', 'r18', 'r19', 'r20', 'r21', 'r22', 'r23', 'r24', 'r25', 'r26', 'r27', 'r28', 'r29', 'r30', 'r31', 'r32', 'r33', 'r34', 'r35', 'r36', 'r37', 'r38', 'r39', 'r40', 'r41', 'r42', 'r43', 'r44', 'r45', 'r46', 'r47', 'r48', 'r49', 'r50'];
  assert.deepEqual(rankFiles(paths.reverse(), 'r'), ['r00', 'r01', 'r02', 'r03', 'r04', 'r05', 'r06', 'r07', 'r08', 'r09', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15', 'r16', 'r17', 'r18', 'r19', 'r20', 'r21', 'r22', 'r23', 'r24', 'r25', 'r26', 'r27', 'r28', 'r29', 'r30', 'r31', 'r32', 'r33', 'r34', 'r35', 'r36', 'r37', 'r38', 'r39', 'r40', 'r41', 'r42', 'r43', 'r44', 'r45', 'r46', 'r47', 'r48', 'r49']);
});

const mainBytes = readFileSync(new URL('../src/main.ts', import.meta.url));
function finder() {
  const text = mainBytes.toString('utf8');
  const start = text.indexOf("on('fsFind',");
  const end = text.indexOf("on('fsRead',", start);
  assert.ok(start >= 0 && end > start, 'fsFind registration exists in main source');
  const calls: any[] = [];
  let handler: any;
  const context = vm.createContext({
    on: (name: string, fn: Function) => { assert.equal(name, 'fsFind'); handler = fn; },
    projectRoot: (id: unknown) => id === 'p1' ? '/synthetic/project' : null,
    runIn: (root: string) => async (args: string[]) => { calls.push(['git', root, Array.from(args)]); return 'src/a b.js\0src/line\nbreak.js\0'; },
    rankFiles: (paths: string[], query: string) => { calls.push(['rank', Array.from(paths), query]); return ['synthetic-result']; },
  });
  vm.runInContext(stripTypeScriptTypes(text.slice(start, end)), context);
  return { handler, calls };
}

test('main source contains no raw NUL byte', () => {
  assert.equal(mainBytes.includes(0), false);
});

test('fsFind runs exact git arguments in the project root and splits on NUL', async () => {
  const h = finder();
  assert.deepEqual(Array.from(await h.handler('p1', 'a')), ['synthetic-result']);
  assert.deepEqual(h.calls, [
    ['git', '/synthetic/project', ['ls-files', '-z', '--cached', '--others', '--exclude-standard']],
    ['rank', ['src/a b.js', 'src/line\nbreak.js'], 'a'],
  ]);
});

test('fsFind rejects missing projects and non-string queries without running git', async () => {
  const h = finder();
  for (const [pid, query] of [['missing', 'a'], [null, 'a'], ['p1', null], ['p1', undefined], ['p1', 1], ['p1', {}], ['p1', ['a']]]) {
    assert.deepEqual(Array.from(await h.handler(pid, query)), []);
  }
  assert.deepEqual(h.calls, []);
});

test('fsFind accepts 200 characters and rejects 201 before running git', async () => {
  const h = finder();
  assert.deepEqual(Array.from(await h.handler('p1', 'a'.repeat(201))), []);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(Array.from(await h.handler('p1', 'a'.repeat(200))), ['synthetic-result']);
  assert.equal(h.calls.length, 2);
});
