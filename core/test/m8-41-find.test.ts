import test from 'node:test';
import assert from 'node:assert/strict';
import { findLines } from '../src/browser/snapshot.ts';
import { tokenCount } from '../src/meter.ts';

// protects=a hit line that carries its own [ref=...] gives the block that ref, even when an ancestor has one too
// fails_when=the ref is taken from the ancestor button instead of the hit line
// no_claim=how refs are assigned to elements (the snapshot render tests)
test('M8-41a ref is the hit line own ref', () => {
  const lines = ['main', '  button "Menu" [ref=e3]', '    link "Pricing" [ref=e12]'];
  assert.equal(findLines(lines, 'Pricing')[0], 'ref=e12 path: main > button "Menu"');
});

// protects=a hit with no ref of its own takes the ref of its nearest ancestor that has one, skipping ref-less ancestors
// fails_when=the hit gets no ref although an ancestor has one, or the root is used instead of the nearest ancestor
// no_claim=which elements are actionable enough to carry a ref
test('M8-41a ref of a ref-less hit is its nearest ancestor ref', () => {
  const lines = ['main', '  button "Save" [ref=e5]', '    group', '      StaticText "Saved just now"'];
  assert.equal(findLines(lines, 'saved')[0], 'ref=e5 path: main > button "Save" > group');
});

// protects=a hit with no ref on it or any ancestor reads ref=none
// fails_when=the block invents a ref, or leaves the ref empty instead of writing none
// no_claim=the path text (covered by the path tests)
test('M8-41a ref is none when no line above the hit has one', () => {
  const lines = ['main', '  heading "Hello"', '    StaticText "Welcome back"'];
  assert.equal(findLines(lines, 'welcome')[0], 'ref=none path: main > heading "Hello"');
});

// protects=the path lists ancestors root first, without indentation, [ref=...], [covered] or [offscreen]
// fails_when=an ancestor keeps its ref or its covered/offscreen tag, or the order is reversed or the indent is kept
// no_claim=the context lines, which the context tests cover
test('M8-41a path is the ancestor chain root-down with ref and state tags removed', () => {
  const lines = [
    'main',
    '  navigation "Site" [covered]',
    '    link "Docs" [ref=e9] [offscreen]',
    '      listitem',
    '        link "Pricing" [ref=e12]',
  ];
  assert.equal(
    findLines(lines, 'Pricing')[0],
    'ref=e12 path: main > navigation "Site" > link "Docs" > listitem',
  );
});

// protects=a top-level hit has no ancestors, so its path is (root)
// fails_when=a top-level hit gets an empty path or a path that names itself
// no_claim=whether the root line is itself a valid ref carrier
test('M8-41a top-level hit has path (root)', () => {
  assert.equal(findLines(['link "Pricing" [ref=e2]'], 'Pricing')[0], 'ref=e2 path: (root)');
  assert.equal(findLines(['heading "Pricing"'], 'Pricing')[0], 'ref=none path: (root)');
});

// protects=the block has the line before (two spaces), the hit (> ) and the line after (two spaces), all with indentation removed
// fails_when=a context line keeps its indentation, the hit loses its > prefix, or the wrong neighbour is shown
// no_claim=the path line
test('M8-41a context is the line before, the hit and the line after', () => {
  const lines = ['main', '  link "One" [ref=e1]', '  link "Pricing" [ref=e2]', '  link "Three" [ref=e3]'];
  assert.deepEqual(findLines(lines, 'pricing'), [
    'ref=e2 path: main',
    '  link "One" [ref=e1]',
    '> link "Pricing" [ref=e2]',
    '  link "Three" [ref=e3]',
  ]);
});

// protects=a hit on the first or last line has no before or after context line, so the block is shorter
// fails_when=an empty or undefined context line is written at the edge
// no_claim=the path line of these blocks
test('M8-41a context is omitted at the first and last line', () => {
  assert.deepEqual(findLines(['link "Pricing" [ref=e1]', '  x "y"'], 'Pricing'), [
    'ref=e1 path: (root)',
    '> link "Pricing" [ref=e1]',
    '  x "y"',
  ]);
  assert.deepEqual(findLines(['main', '  x "y"', '  link "Pricing" [ref=e1]'], 'Pricing'), [
    'ref=e1 path: main',
    '  x "y"',
    '> link "Pricing" [ref=e1]',
  ]);
});

// protects=the match is case-insensitive, and two blocks are separated by exactly one empty line
// fails_when=an upper-case hit is missed, or the blocks run together or are split by two blank lines
// no_claim=the token budget (covered by the token test)
test('M8-41a match ignores case and blocks are separated by one empty line', () => {
  const lines = ['main', '  link "PRICING" [ref=e1]', '  x "a"', '  link "pricing plan" [ref=e2]'];
  assert.deepEqual(findLines(lines, 'Pricing'), [
    'ref=e1 path: main',
    '  main',
    '> link "PRICING" [ref=e1]',
    '  x "a"',
    '',
    'ref=e2 path: main',
    '  x "a"',
    '> link "pricing plan" [ref=e2]',
  ]);
  assert.equal(findLines(lines, 'Pricing').filter((l) => l === '').length, 1);
});

// protects=a query with no hit gives exactly one line saying so, with the query quoted
// fails_when=the result is empty, or the message is worded differently or lacks the query
// no_claim=the no-match case for an empty query (the server rejects that before findLines runs)
test('M8-41a no hit gives exactly the no match line', () => {
  assert.deepEqual(findLines(['main', '  link "Docs" [ref=e1]'], 'Pricing'), ['no match for "Pricing"']);
});

// protects=at most 50 blocks are shown, and when there are more the last line says how many matched
// fails_when=a 51st block is shown, or the count line is missing or reports the wrong total
// no_claim=the token budget applied to the output (the server's fit step)
test('M8-41a more than 50 hits shows 50 blocks and a count line', () => {
  const lines = ['main', ...Array.from({ length: 60 }, (_, i) => `  link "Item ${i}" [ref=e${i + 1}]`)];
  const out = findLines(lines, 'item');
  assert.equal(out.filter((l) => l.startsWith('ref=')).length, 50);
  assert.equal(out[out.length - 1], '(50 of 60 matches shown; narrow the query)');
});

// The fixture: a shop page with a nav, 20 product lists of 12 links, and a newsletter form with an Email textbox
// and a Subscribe button seven levels deep.
function shopPage(): string[] {
  const out = ['RootWebArea "Shop"', '  banner', '    navigation "Site"', '      list'];
  for (let i = 0; i < 12; i++) out.push('        listitem', `          link "Section ${i}" [ref=e${10 + i}]`);
  out.push('  main');
  for (let s = 0; s < 20; s++) {
    out.push('    list "Products"');
    for (let j = 0; j < 12; j++) out.push('      listitem', `        link "Product ${s}-${j} details" [ref=e${100 + s * 12 + j}]`);
  }
  out.push(
    '    region "Newsletter"',
    '      group',
    '        group',
    '          form',
    '            textbox "Email" [ref=e411]',
    '            group',
    '              button "Subscribe" [ref=e412]',
    '  contentinfo',
    '    StaticText "Copyright 2026"',
  );
  return out;
}

// protects=a search for Subscribe on a 300-plus line page returns the button's ref first and under a tenth of the snapshot's tokens
// fails_when=the button's ref is not in the first line, or the hit block is a tenth or more of the page's token count
// no_claim=the token numbers for any other page or query; this checks one realistic fixture
test('M8-41a find on a 300-line page returns the Subscribe ref first in under a tenth of the tokens', () => {
  const lines = shopPage();
  assert.ok(lines.length >= 300, `fixture has ${lines.length} lines`);
  const result = findLines(lines, 'Subscribe');
  assert.ok(result[0].startsWith('ref=e412 '), `first line was: ${result[0]}`);
  const pageTokens = tokenCount(lines.join('\n'));
  const resultTokens = tokenCount(result.join('\n'));
  console.log(`M8-41a token count: find result ${resultTokens}, snapshot of ${lines.length} lines ${pageTokens}`);
  assert.ok(resultTokens < pageTokens / 10, `find result ${resultTokens} is not under a tenth of ${pageTokens}`);
});
