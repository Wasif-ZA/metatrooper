import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { expand } from '../ui/src/kit/check.js';

const ui = fileURLToPath(new URL('../ui/', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm8-16-screens-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const requireUI = createRequire(join(ui, 'package.json'));
const { build } = requireUI('esbuild');
try { await build({
  stdin: { contents: "export { DrawnTabs, syncDrawn } from './src/kit/DrawnTabs.jsx'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';", resolveDir: ui, loader: 'jsx' },
  absWorkingDir: ui, tsconfigRaw: {}, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic',
  loader: { '.css': 'empty' }, outfile: join(temp, 'tabs.mjs'),
  plugins: [{ name: 'installed-dependencies', setup(b: any) {
    b.onResolve({ filter: /^[^./]|^@/ }, (args: any) => ({ path: pathToFileURL(requireUI.resolve(args.path)).href, external: true }));
  } }],
}); } catch (error: any) {
  if (error.code !== 'EPERM' || process.platform !== 'win32') throw error;
  const entry = join(temp, 'entry.jsx');
  writeFileSync(entry, `export { DrawnTabs, syncDrawn } from ${JSON.stringify(join(ui, 'src/kit/DrawnTabs.jsx'))}; export * as React from ${JSON.stringify(requireUI.resolve('react'))}; export { renderToStaticMarkup } from ${JSON.stringify(requireUI.resolve('react-dom/server'))};`);
  const binary = join(dirname(requireUI.resolve('esbuild/package.json')), '../@esbuild/win32-x64/esbuild.exe');
  await new Promise<void>((resolveBuild, reject) => {
    const child = spawn(binary, [entry, '--bundle', '--platform=node', '--format=esm', '--jsx=automatic', '--loader:.css=empty', '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);', '--outfile=' + join(temp, 'tabs.mjs')], { stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolveBuild() : reject(new Error('esbuild exited ' + code)));
  });
}
const { DrawnTabs, syncDrawn, React, renderToStaticMarkup } = await import(pathToFileURL(join(temp, 'tabs.mjs')).href);

test('f-find, f-data and f-outline draw in a tab', async (t) => {
  // protects=M8-16d built-in specs validate without fallback and draw in the tab zone fails_when=any part falls back, a surface fails to open in DrawnTabs, or rendered content is missing or malformed no_claim=browser layout, clicks, or the live core transport
  const globals = globalThis as any;
  const previous = ['ui', 'api'].map(key => [key, Object.getOwnPropertyDescriptor(globals, key)] as const);
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globals, key, descriptor);
      else delete globals[key];
    }
  });

  for (const name of ['f-find', 'f-data', 'f-outline']) {
    const fixture = JSON.parse(readFileSync(new URL(`./fixtures/m8-16/${name}.json`, import.meta.url), 'utf8'));
    const spec = fixture.spec;
    assert.deepEqual(expand(spec).fellBack, [], `${name}: no part may fall back`);

    // Rename a part in memory only; the same empty-fellBack assertion rejects this copy.
    const broken = structuredClone(spec);
    broken.children[0].type = 'm8-16-unknown-part';
    assert.ok(expand(broken).fellBack.some((part: any) => part.type === 'm8-16-unknown-part'), `${name}: unknown parts must be reported`);

    const pid = `m8-16-${name}`;
    const surface = { id: `${name}-surface`, project_id: pid, title: fixture.tab, session_id: `${name}-session`, seq: 1 };
    const calls: unknown[] = [];
    globals.ui = { projectId: pid, view: 'ide', snap: { surfaces: [] as any[] } };
    globals.api = { async call(method: string, params: unknown) {
      calls.push([method, params]);
      assert.equal(method, 'ui.get');
      assert.deepEqual(params, { surface: surface.id });
      return { kind: 'reply', reply: { result: { spec, seq: surface.seq } } };
    } };

    // Initialize the project before publishing its surface so syncDrawn activates the new tab.
    await syncDrawn();
    assert.equal(renderToStaticMarkup(React.createElement(DrawnTabs, { pid })), '');
    globals.ui.snap.surfaces = [surface];
    await syncDrawn();
    const html = renderToStaticMarkup(React.createElement(DrawnTabs, { pid }));
    assert.deepEqual(calls, [['ui.get', { surface: surface.id }]], `${name}: fetch the surface`);
    assert.match(html, /class="ou-drawn-layer"/, `${name}: active tab zone`);
    assert.match(html, /class="ou-drawn"/, `${name}: Drawn content`);
    assert.doesNotMatch(html, /undefined|NaN|\[object/, name);
    assert.doesNotMatch(html, /class="ou-drawn-plain"/, `${name}: no render fallback`);
    const expected = name === 'f-find' ? spec.children[0].children[0][0].groups[0].rows[0].name : spec.children[0].title;
    assert.equal(typeof expected, 'string', `${name}: fixture text`);
    assert.ok(expected.length > 0, `${name}: nonempty fixture text`);
    assert.ok(html.includes(expected), `${name}: draws fixture text ${JSON.stringify(expected)}`);
  }
});
