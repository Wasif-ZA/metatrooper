import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { diffLines, dropFrame, fit, interactiveOnly, newRefs, render, resolveRef, type Frame } from '../src/browser/snapshot.ts';
import { tokenCount } from '../src/meter.ts';

test('M6-11a stable refs across renders, removal diff, frame drop, and new ref numbers', () => {
  const refs = newRefs();
  const frames: Frame[] = [
    {
      id: 'main',
      nodes: [
        { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2', '3'] },
        { nodeId: '2', parentId: '1', role: { value: 'button' }, name: { value: 'Submit' }, backendDOMNodeId: 101 },
        { nodeId: '3', parentId: '1', role: { value: 'link' }, name: { value: 'Home' }, backendDOMNodeId: 102 },
      ],
    },
    {
      id: 'child1',
      parent: 'main',
      owner: 102,
      nodes: [
        { nodeId: 'c1', role: { value: 'RootWebArea' }, childIds: ['c2'] },
        { nodeId: 'c2', parentId: 'c1', role: { value: 'button' }, name: { value: 'ChildAction' }, backendDOMNodeId: 201 },
      ],
    },
  ];

  // Render the same frames twice with one Refs object gives identical text and refs.
  const first = render(frames, refs);
  const second = render(frames, refs);
  assert.deepEqual(first, second);
  assert.deepEqual(first, [
    'RootWebArea',
    '  button "Submit" [ref=e1]',
    '  link "Home" [ref=e2]',
    '    RootWebArea',
    '      button "ChildAction" [ref=f1e3]',
  ]);

  // Removing one node keeps refs for the others and diffLines marks the old line with its ref as removed.
  const framesAfterRemove: Frame[] = [
    {
      id: 'main',
      nodes: [
        { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['3'] },
        { nodeId: '3', parentId: '1', role: { value: 'link' }, name: { value: 'Home' }, backendDOMNodeId: 102 },
      ],
    },
    {
      id: 'child1',
      parent: 'main',
      owner: 102,
      nodes: [
        { nodeId: 'c1', role: { value: 'RootWebArea' }, childIds: ['c2'] },
        { nodeId: 'c2', parentId: 'c1', role: { value: 'button' }, name: { value: 'ChildAction' }, backendDOMNodeId: 201 },
      ],
    },
  ];
  const third = render(framesAfterRemove, refs);
  assert.deepEqual(third, [
    'RootWebArea',
    '  link "Home" [ref=e2]',
    '    RootWebArea',
    '      button "ChildAction" [ref=f1e3]',
  ]);
  const diff = diffLines(first!, third!);
  assert.deepEqual(diff, ['-   button "Submit" [ref=e1]']);

  // Drop child frame refs: resolveRef returns gone for the newest ref and unknown for one higher.
  dropFrame(refs, 'child1');
  assert.equal(resolveRef(refs, 'f1e3'), 'gone');
  assert.equal(resolveRef(refs, 'f1e4'), 'unknown');
  assert.equal(resolveRef(refs, 'e4'), 'unknown');
  assert.deepEqual(resolveRef(refs, 'e2'), { frameId: 'main', backendNodeId: 102 });

  // A fresh render after dropFrame assigns new ref numbers to the child frame nodes.
  const fourth = render(framesAfterRemove, refs);
  assert.deepEqual(fourth, [
    'RootWebArea',
    '  link "Home" [ref=e2]',
    '    RootWebArea',
    '      button "ChildAction" [ref=f1e4]',
  ]);
  assert.deepEqual(resolveRef(refs, 'f1e4'), { frameId: 'child1', backendNodeId: 201 });
  assert.equal(resolveRef(refs, 'f1e3'), 'gone');
});

test('M6-11b iframe owner nesting with f-tagged refs, unreadable frame omission, and orphan frame rendering', () => {
  const refs = newRefs();
  const frames: Frame[] = [
    {
      id: 'main',
      nodes: [
        { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2', '3'] },
        { nodeId: '2', parentId: '1', role: { value: 'Iframe' }, backendDOMNodeId: 300 },
        { nodeId: '3', parentId: '1', role: { value: 'button' }, name: { value: 'Main' }, backendDOMNodeId: 301 },
      ],
    },
    {
      id: 'child-owned',
      parent: 'main',
      owner: 300,
      nodes: [
        { nodeId: 'c1', role: { value: 'RootWebArea' }, childIds: ['c2'] },
        { nodeId: 'c2', parentId: 'c1', role: { value: 'button' }, name: { value: 'Nested' }, backendDOMNodeId: 400 },
      ],
    },
    {
      id: 'child-unreadable',
      parent: 'main',
      owner: 301,
      nodes: [],
    },
    {
      id: 'child-orphan',
      parent: 'main',
      owner: 9999,
      nodes: [
        { nodeId: 'o1', role: { value: 'RootWebArea' }, childIds: ['o2'] },
        { nodeId: 'o2', parentId: 'o1', role: { value: 'link' }, name: { value: 'Orphan' }, backendDOMNodeId: 500 },
      ],
    },
  ];

  const lines = render(frames, refs);
  // Child frame nests under Iframe line with f-tagged ref, unreadable frame is omitted, unmatched owner renders at top.
  assert.deepEqual(lines, [
    'RootWebArea',
    '  Iframe',
    '    RootWebArea',
    '      button "Nested" [ref=f1e1]',
    '  button "Main" [ref=e2]',
    'RootWebArea',
    '  link "Orphan" [ref=f2e3]',
  ]);
});

test('M6-11c fit budget on 20,000 synthetic lines and progress on lines exceeding budget', () => {
  const lines20k = Array.from({ length: 20000 }, (_, i) => `button "Item ${i}" [ref=e${i + 1}]`);
  const trailer = '(cut at 4000 tokens; call snapshot with continue="c1" for the rest)';

  // Head joined with trailer fits within 4000 tokens.
  const initial = fit(lines20k, 4000, trailer);
  assert.ok(initial.head.length > 0);
  assert.ok(initial.rest.length > 0);
  const headText = [...initial.head, trailer].join('\n');
  assert.ok(tokenCount(headText) <= 4000);

  // Repeatedly fitting the rest returns every line in order with no drops.
  const collected: string[] = [];
  let remaining = lines20k;
  while (remaining.length > 0) {
    const chunk = fit(remaining, 4000, trailer);
    if (chunk.rest.length > 0) {
      assert.ok(tokenCount([...chunk.head, trailer].join('\n')) <= 4000);
    }
    collected.push(...chunk.head);
    remaining = chunk.rest;
  }
  assert.deepEqual(collected, lines20k);

  // A single line longer than the token budget still makes progress by splitting.
  const hugeLine = 'x'.repeat(15000);
  const hugeResult = fit([hugeLine, 'following line'], 4000, trailer);
  assert.ok(hugeResult.head.length > 0);
  assert.deepEqual(hugeResult.rest, ['following line']);
});

test('scope subtree filtering and null for missing scope', () => {
  const refs = newRefs();
  const frames: Frame[] = [
    {
      id: 'main',
      nodes: [
        { nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2', '3'] },
        { nodeId: '2', parentId: '1', role: { value: 'region' }, name: { value: 'Sidebar' }, backendDOMNodeId: 10, childIds: ['4'] },
        { nodeId: '4', parentId: '2', role: { value: 'button' }, name: { value: 'InSidebar' }, backendDOMNodeId: 11 },
        { nodeId: '3', parentId: '1', role: { value: 'button' }, name: { value: 'Outside' }, backendDOMNodeId: 12 },
      ],
    },
  ];

  // Scope to region renders only the region subtree starting at depth 0.
  const scoped = render(frames, refs, { frameId: 'main', backendNodeId: 10 });
  assert.deepEqual(scoped, [
    'region "Sidebar"',
    '  button "InSidebar" [ref=e1]',
  ]);

  // Scope not found in any frame returns null.
  assert.equal(render(frames, refs, { frameId: 'main', backendNodeId: 9999 }), null);
  assert.equal(render(frames, refs, { frameId: 'nonexistent', backendNodeId: 10 }), null);
});

test('interactiveOnly keeps nodes with refs and their ancestors', () => {
  const full = [
    'RootWebArea',
    '  navigation "Nav"',
    '    button "Home" [ref=e1]',
    '  main "Content"',
    '    heading "Title"',
    '    paragraph',
    '      StaticText "Non-interactive text"',
    '    button "Save" [ref=e2]',
    '  footer',
    '    StaticText "Footer notes"',
  ];
  const interactive = interactiveOnly(full);
  assert.deepEqual(interactive, [
    'RootWebArea',
    '  navigation "Nav"',
    '    button "Home" [ref=e1]',
    '  main "Content"',
    '    button "Save" [ref=e2]',
  ]);
});

test('diffLines handles duplicate lines as multiset differences', () => {
  const prev = ['line A', 'line A', 'line B'];
  const cur = ['line A', 'line B', 'line B', 'line C'];
  const diff = diffLines(prev, cur);
  assert.deepEqual(diff, [
    '+ line B',
    '+ line C',
    '- line A',
  ]);
});

test('resolveRef rejects garbage input and unknown refs', () => {
  const refs = newRefs();
  assert.equal(resolveRef(refs, null), 'unknown');
  assert.equal(resolveRef(refs, undefined), 'unknown');
  assert.equal(resolveRef(refs, 123), 'unknown');
  assert.equal(resolveRef(refs, ''), 'unknown');
  assert.equal(resolveRef(refs, 'invalid-ref'), 'unknown');
  assert.equal(resolveRef(refs, 'e1'), 'unknown');
  assert.equal(resolveRef(refs, 'f1e1'), 'unknown');
});

test('tokenCount measures ASCII and multi-byte UTF-8 token budgets', () => {
  assert.equal(tokenCount(''), 0);
  assert.equal(tokenCount('a'), 1);
  assert.equal(tokenCount('abc'), 1);
  assert.equal(tokenCount('abcd'), 2);
  assert.equal(tokenCount('123456'), 2);
  assert.equal(tokenCount('1234567'), 3);
  assert.equal(tokenCount('€'), 1);
  assert.equal(tokenCount('€€'), 2);
  assert.equal(tokenCount('😀'), 2);
});

test('browser-mcp tools/list exposes read tool and correct readOnly/destructive annotations', async () => {
  const script = resolve(import.meta.dirname, '..', 'metatrooper-browser.js');
  const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'inherit'] });

  const responses: any[] = [];
  let buffer = '';

  const done = new Promise<void>((res, rej) => {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i; (i = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          responses.push(parsed);
          if (parsed.id === 2) {
            res();
          }
        } catch (err) {
          rej(err);
        }
      }
    });
    child.on('error', rej);
  });

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');

  try {
    await done;
  } finally {
    child.stdin.end();
    child.kill();
  }

  const listResponse = responses.find((r) => r.id === 2);
  assert.ok(listResponse?.result?.tools, 'tools array exists');
  const tools: Array<{ name: string; annotations: Record<string, boolean> }> = listResponse.result.tools;

  // Verify that read tool exists.
  assert.ok(tools.some((t) => t.name === 'read'), 'read tool exists');

  // Verify annotations for each tool.
  const readOnlySet = new Set(['panes', 'snapshot', 'screenshot', 'read', 'console', 'network', 'wait_for']);
  for (const tool of tools) {
    if (readOnlySet.has(tool.name)) {
      assert.deepEqual(tool.annotations, { readOnlyHint: true }, `tool ${tool.name} readOnlyHint`);
    } else {
      assert.deepEqual(tool.annotations, { readOnlyHint: false, destructiveHint: true }, `tool ${tool.name} destructiveHint`);
    }
  }
});
