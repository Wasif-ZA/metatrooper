import test from 'node:test';
import assert from 'node:assert/strict';
import { numberBoxes } from '../src/browser/snapshot.ts';

// protects=boxes entirely outside the captured area get no legend line; a partly visible box is clamped to the area before its coordinates are written.
// fails_when=an outside box gets a line, or a partly visible box keeps its unclipped x,y,w,h.
// no_claim=does not check the kept field beyond its ref order, the picture pixels, or the MCP text item.
test('M7-01b legend drops boxes outside the area', () => {
  const area = { left: 0, top: 0, right: 800, bottom: 600 };
  const boxes = [
    { ref: 'e1', left: 10, top: 10, right: 60, bottom: 40 },
    { ref: 'e2', left: 900, top: 10, right: 950, bottom: 40 },
    { ref: 'e3', left: 10, top: 700, right: 60, bottom: 740 },
    { ref: 'e4', left: 100, top: 100, right: 140, bottom: 130 },
  ];
  const { kept, legend } = numberBoxes(boxes, area);
  assert.deepEqual(legend, ['1 -> e1, 10,10,50,30', '2 -> e4, 100,100,40,30']);
  assert.deepEqual(kept.map((b) => b.ref), ['e1', 'e4']);
});

// protects=a box that sticks out of the area on one side is clipped to the area, so its legend line matches the visible part.
// fails_when=the legend writes the unclipped box for a box that crosses an edge.
// no_claim=does not test a box that only touches the area edge with zero overlap, since the spec does not fix that case.
test('M7-01b legend clamps a box that is partly inside', () => {
  const area = { left: 0, top: 0, right: 100, bottom: 100 };
  const boxes = [
    { ref: 'f1', left: -20, top: 50, right: 30, bottom: 120 },
    { ref: 'e9', left: 90, top: 0, right: 150, bottom: 10 },
  ];
  const { legend } = numberBoxes(boxes, area);
  assert.deepEqual(legend, ['1 -> f1, 0,50,30,50', '2 -> e9, 90,0,10,10']);
});

// protects=numbers run 1, 2, 3 in input order over the boxes that are kept, so the legend has one line per number with no gap.
// fails_when=numbers follow input position so a dropped box leaves a gap, or numbering starts at 0 or follows sort order instead of input order.
// no_claim=the gap-free rule for dropped boxes is the reading of "one line per number" in the contract; the spec's text alone does not say whether dropped boxes take a number.
test('M7-01b numbering starts at 1 in input order', () => {
  const area = { left: 0, top: 0, right: 500, bottom: 500 };
  const boxes = [
    { ref: 'e7', left: 10, top: 10, right: 20, bottom: 20 },
    { ref: 'e8', left: 900, top: 900, right: 910, bottom: 910 },
    { ref: 'e3', left: 30, top: 30, right: 40, bottom: 40 },
    { ref: 'e5', left: 50, top: 50, right: 60, bottom: 60 },
  ];
  const { legend } = numberBoxes(boxes, area);
  assert.deepEqual(legend, ['1 -> e7, 10,10,10,10', '2 -> e3, 30,30,10,10', '3 -> e5, 50,50,10,10']);
});

// protects=the line format is `n -> ref, x,y,w,h` with x,y measured from the area's top-left (the captured picture's top-left), not from the page origin.
// fails_when=the coordinates are page-absolute for a ref crop, or the separator, arrow or field order differs.
// no_claim=does not check that w and h are the border box rather than the content box; the boxes here are plain values.
test('M7-01b legend line format is exact and relative to the area', () => {
  const area = { left: 100, top: 50, right: 500, bottom: 350 };
  const boxes = [{ ref: 'f1e4', left: 120, top: 60, right: 180, bottom: 90 }];
  const { legend } = numberBoxes(boxes, area);
  assert.deepEqual(legend, ['1 -> f1e4, 20,10,60,30']);
  assert.match(legend[0], /^\d+ -> \S+, -?\d+,-?\d+,\d+,\d+$/);
});

// protects=an empty box list gives an empty legend, so an annotated screenshot of a page with no refs adds no lines.
// fails_when=a placeholder line appears when nothing is numbered.
// no_claim=does not check the shape of kept beyond being empty.
test('M7-01b legend is empty when no box is given', () => {
  const { kept, legend } = numberBoxes([], { left: 0, top: 0, right: 100, bottom: 100 });
  assert.deepEqual(legend, []);
  assert.deepEqual(kept, []);
});
