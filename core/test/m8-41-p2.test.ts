import test from 'node:test';
import assert from 'node:assert/strict';
import { exportTest, type Step } from '../src/browser/export-test.ts';
import { newRefs, render, type Frame } from '../src/browser/snapshot.ts';

const HEAD = "import { test } from '@playwright/test';\n\ntest('recorded by MetaTrooper', async ({ page }) => {\n";
const TAIL = '});\n';

// Build a child frame whose iframe host inherits its parent's hidden state.
function iframeFrames(hidden: boolean): Frame[] {
  return [{
    id: 'main',
    hidden: new Set(hidden ? [50] : []),
    nodes: [
      { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2'] },
      { nodeId: '2', parentId: '1', role: { value: 'generic' }, backendDOMNodeId: 50, childIds: ['3'] },
      { nodeId: '3', parentId: '2', role: { value: 'Iframe' }, backendDOMNodeId: 60 },
    ],
  }, {
    id: 'child',
    parent: 'main',
    owner: 60,
    nodes: [
      { nodeId: 'c1', role: { value: 'RootWebArea' }, name: { value: 'Child document' }, childIds: ['c2', 'c3'] },
      { nodeId: 'c2', parentId: 'c1', role: { value: 'StaticText' }, name: { value: 'Child page text' } },
      { nodeId: 'c3', parentId: 'c1', role: { value: 'button' }, name: { value: 'Child action' }, backendDOMNodeId: 70 },
    ],
  }];
}

test('M8-41-p2 B hidden iframe ancestry suppresses every child text name', () => {
  const lines = render(iframeFrames(true), newRefs());
  assert.ok(lines);
  const text = lines.join('\n');
  assert.ok(!text.includes('Child document'), text);
  assert.ok(!text.includes('Child page text'), text);
  assert.ok(!text.includes('Child action'), text);
});

test('M8-41-p2 B a control in an iframe under a hidden ancestor keeps a hidden ref', () => {
  const lines = render(iframeFrames(true), newRefs());
  assert.ok(lines);
  assert.ok(lines.some(line => line.trim() === 'button [ref=f1e1] [hidden]'), lines.join('\n'));
});

test('M8-41-p2 B a control in a visible iframe retains its name', () => {
  const lines = render(iframeFrames(false), newRefs());
  assert.ok(lines);
  assert.ok(lines.some(line => line.trim() === 'button "Child action" [ref=f1e1]'), lines.join('\n'));
  assert.ok(lines.some(line => line.trim() === 'StaticText "Child page text"'), lines.join('\n'));
});

test('M8-41-p2 C password type uses an exact label and excludes the typed value', () => {
  const step = { tool: 'type', role: 'textbox', name: 'Password', password: true, text: 'p2-typed-secret-84' } as unknown as Step;
  const output = exportTest([step]);
  assert.ok(!output.includes('p2-typed-secret-84'), output);
  assert.ok(!output.includes('getByRole("textbox"'), output);
  assert.equal(output, HEAD + '  await page.getByLabel("Password", { exact: true }).fill(process.env.MT_FILL_1 ?? \'\');\n' + TAIL);
});

test('M8-41-p2 C ordinary type retains an exact textbox role and excludes the typed value', () => {
  const step = { tool: 'type', role: 'textbox', name: 'Password', text: 'p2-ordinary-value-29' } as unknown as Step;
  const output = exportTest([step]);
  assert.ok(!output.includes('p2-ordinary-value-29'), output);
  assert.equal(output, HEAD + '  await page.getByRole("textbox", { name: "Password", exact: true }).fill(process.env.MT_FILL_1 ?? \'\');\n' + TAIL);
});

const keys: Array<[string, string]> = [
  ['ctrl+Enter', '  await page.keyboard.press("Control+Enter");\n'],
  ['CMD+shift+arrowup', '  await page.keyboard.press("Meta+Shift+ArrowUp");\n'],
  ['esc', '  await page.keyboard.press("Escape");\n'],
  ['Return', '  await page.keyboard.press("Enter");\n'],
  ['control+a', '  // a key press was not recorded\n'],
  ['hyper+Enter', '  // a key press was not recorded\n'],
  [' alt + command + pagedown ', '  await page.keyboard.press("Alt+Meta+PageDown");\n'],
  ['SHIFT+TAB', '  await page.keyboard.press("Shift+Tab");\n'],
];

for (const [input, body] of keys) {
  test('M8-41-p2 E key ' + input, () => {
    assert.equal(exportTest([{ tool: 'key', keys: input }]), HEAD + body + TAIL);
  });
}
