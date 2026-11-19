import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Creates a fake element with bounding client rect and connection state.
function makeFakeElement(opts: { width?: number; height?: number; hidden?: boolean; isConnected?: boolean; parentElement?: any } = {}) {
  return {
    isConnected: opts.isConnected ?? true,
    hidden: opts.hidden ?? false,
    parentElement: opts.parentElement ?? null,
    getBoundingClientRect: () => ({
      width: opts.width ?? 100,
      height: opts.height ?? 30,
      top: 0,
      left: 0,
      right: opts.width ?? 100,
      bottom: opts.height ?? 30,
    }),
  };
}

// protects=offerOnEvent returns true for empty string or unset tour and false for done or later
// fails_when=offerOnEvent returns false for empty string or undefined or returns true for done or later
// no_claim=any other tour status value handling beyond these inputs
test('1. offerOnEvent accepts unset tour and ignores done or later', async () => {
  const { offerOnEvent } = await import(new URL('../ui/src/tour.js', import.meta.url).href);
  assert.equal(offerOnEvent(''), true);
  assert.equal(offerOnEvent(undefined), true);
  assert.equal(offerOnEvent(null), true);
  assert.equal(offerOnEvent('done'), false);
  assert.equal(offerOnEvent('later'), false);
});

// protects=offerOnStart returns true only when tour is unset and hasSessions is true
// fails_when=offerOnStart returns false for unset with hasSessions true or returns true when hasSessions is false or tour is set
// no_claim=side effects or UI state mutations outside this predicate
test('2. offerOnStart requires unset tour and existing sessions', async () => {
  const { offerOnStart } = await import(new URL('../ui/src/tour.js', import.meta.url).href);
  assert.equal(offerOnStart('', true), true);
  assert.equal(offerOnStart(undefined, true), true);
  assert.equal(offerOnStart(null, true), true);
  assert.equal(offerOnStart('', false), false);
  assert.equal(offerOnStart(undefined, false), false);
  assert.equal(offerOnStart('later', true), false);
  assert.equal(offerOnStart('done', true), false);
  assert.equal(offerOnStart('later', false), false);
  assert.equal(offerOnStart('done', false), false);
});

// protects=answerOffer sets done on yes, sets later on later, and rejects any other choice without calling setTour
// fails_when=answerOffer resolves with wrong boolean, passes incorrect argument to setTour, or fails to reject unknown choices
// no_claim=persistence mechanism of the setTour callback
test('3. answerOffer handles choices and rejects unknown input', async () => {
  const { answerOffer } = await import(new URL('../ui/src/tour.js', import.meta.url).href);
  const calls: string[] = [];
  const setTour = async (val: string) => { calls.push(val); };

  const yesResult = await answerOffer('yes', setTour);
  assert.equal(yesResult, true);
  assert.deepEqual(calls, ['done']);

  calls.length = 0;
  const laterResult = await answerOffer('later', setTour);
  assert.equal(laterResult, false);
  assert.deepEqual(calls, ['later']);

  calls.length = 0;
  await assert.rejects(async () => {
    await answerOffer('maybe', setTour);
  });
  assert.deepEqual(calls, []);

  await assert.rejects(async () => {
    await answerOffer('no', setTour);
  });
  assert.deepEqual(calls, []);
});

// protects=createTour start begins at stop index 0 and exposes initial label and active state without taking a setting
// fails_when=start fails to set active true, index is not 0, or label does not start at stop 1
// no_claim=persisting tour completion to storage
test('4. Replay: createTour start initializes at index 0 without requiring setting', async () => {
  const { createTour } = await import(new URL('../ui/src/tour.js', import.meta.url).href);
  const el1 = makeFakeElement();
  const el2 = makeFakeElement();
  const doc = {
    querySelector: (sel: string) => {
      if (sel === '#s1') return el1;
      if (sel === '#s2') return el2;
      return null;
    },
  };
  const stops = [
    { id: 's1', selector: '#s1', view: 'home', morph: 'a', line: 'First stop' },
    { id: 's2', selector: '#s2', view: 'ide', morph: 'b', line: 'Second stop' },
  ];
  let currentView = 'home';
  let ended = 0;
  const tour = createTour({
    doc,
    stops,
    getView: () => currentView,
    setView: (v: string) => { currentView = v; },
    onEnd: () => { ended++; },
  });

  assert.equal(tour.active, false);
  assert.equal(tour.total, 2);
  tour.start();
  assert.equal(tour.active, true);
  assert.equal(tour.index, 0);
  assert.deepEqual(tour.current(), stops[0]);
  assert.equal(tour.label(), '1 of 2');
  assert.equal(ended, 0);
});

// protects=skip at first middle or last stop terminates tour restores startView and invokes onEnd exactly once
// fails_when=active remains true onEnd is not called or called repeatedly or view is not restored to startView
// no_claim=visual transition styling during view restoration
test('5. Skip at first, a middle and the last stop', async () => {
  const { createTour } = await import(new URL('../ui/src/tour.js', import.meta.url).href);
  const el1 = makeFakeElement();
  const el2 = makeFakeElement();
  const el3 = makeFakeElement();
  const doc = {
    querySelector: (sel: string) => {
      if (sel === '#s1') return el1;
      if (sel === '#s2') return el2;
      if (sel === '#s3') return el3;
      return null;
    },
  };
  const stops = [
    { id: 's1', selector: '#s1', view: 'ide', morph: 'a', line: 'First stop' },
    { id: 's2', selector: '#s2', view: 'wall', morph: 'b', line: 'Middle stop' },
    { id: 's3', selector: '#s3', view: 'inbox', morph: 'c', line: 'Last stop' },
  ];

  // Tests skipping at first stop.
  let view = 'home';
  let ended = 0;
  const tourFirst = createTour({
    doc,
    stops,
    getView: () => view,
    setView: (v: string) => { view = v; },
    onEnd: () => { ended++; },
  });
  tourFirst.start();
  assert.equal(tourFirst.active, true);
  assert.equal(view, 'ide');
  tourFirst.skip();
  assert.equal(tourFirst.active, false);
  assert.equal(view, 'home');
  assert.equal(ended, 1);
  tourFirst.skip();
  tourFirst.next();
  assert.equal(ended, 1);

  // Tests skipping at middle stop.
  view = 'home';
  ended = 0;
  const tourMiddle = createTour({
    doc,
    stops,
    getView: () => view,
    setView: (v: string) => { view = v; },
    onEnd: () => { ended++; },
  });
  tourMiddle.start();
  tourMiddle.next();
  assert.equal(tourMiddle.index, 1);
  assert.equal(view, 'wall');
  tourMiddle.skip();
  assert.equal(tourMiddle.active, false);
  assert.equal(view, 'home');
  assert.equal(ended, 1);
  tourMiddle.skip();
  tourMiddle.next();
  assert.equal(ended, 1);

  // Tests skipping at last stop.
  view = 'home';
  ended = 0;
  const tourLast = createTour({
    doc,
    stops,
    getView: () => view,
    setView: (v: string) => { view = v; },
    onEnd: () => { ended++; },
  });
  tourLast.start();
  tourLast.next();
  tourLast.next();
  assert.equal(tourLast.index, 2);
  assert.equal(view, 'inbox');
  tourLast.skip();
  assert.equal(tourLast.active, false);
  assert.equal(view, 'home');
  assert.equal(ended, 1);
  tourLast.skip();
  tourLast.next();
  assert.equal(ended, 1);
});

// protects=next iterates through all stops updates label and nextLabel and ends tour when advancing past last stop
// fails_when=label text is incorrect nextLabel is Done prematurely or tour fails to end after final stop
// no_claim=DOM focus changes as stops advance
test('6. next through all stops', async () => {
  const { createTour } = await import(new URL('../ui/src/tour.js', import.meta.url).href);
  const el1 = makeFakeElement();
  const el2 = makeFakeElement();
  const el3 = makeFakeElement();
  const doc = {
    querySelector: (sel: string) => {
      if (sel === '#s1') return el1;
      if (sel === '#s2') return el2;
      if (sel === '#s3') return el3;
      return null;
    },
  };
  const stops = [
    { id: 's1', selector: '#s1', view: 'home', morph: 'a', line: 'First stop' },
    { id: 's2', selector: '#s2', view: 'home', morph: 'b', line: 'Second stop' },
    { id: 's3', selector: '#s3', view: 'home', morph: 'c', line: 'Third stop' },
  ];
  let curView = 'home';
  let ended = 0;
  const tour = createTour({
    doc,
    stops,
    getView: () => curView,
    setView: (v: string) => { curView = v; },
    onEnd: () => { ended++; },
  });

  tour.start();
  assert.equal(tour.active, true);
  assert.equal(tour.index, 0);
  assert.equal(tour.label(), '1 of 3');
  assert.equal(tour.nextLabel(), 'Next');

  tour.next();
  assert.equal(tour.active, true);
  assert.equal(tour.index, 1);
  assert.equal(tour.label(), '2 of 3');
  assert.equal(tour.nextLabel(), 'Next');

  tour.next();
  assert.equal(tour.active, true);
  assert.equal(tour.index, 2);
  assert.equal(tour.label(), '3 of 3');
  assert.equal(tour.nextLabel(), 'Done');

  tour.next();
  assert.equal(tour.active, false);
  assert.equal(ended, 1);

  tour.next();
  assert.equal(ended, 1);
});

// protects=visible and stopsFor filter elements by connected status dimensions and ancestor visibility
// fails_when=hidden disconnected zero size or missing elements are counted in tour stops
// no_claim=css computed style rules beyond element property checks
test('7. visibility rules filter out invalid elements and adjust tour total', async () => {
  const { visible, stopsFor, createTour } = await import(new URL('../ui/src/tour.js', import.meta.url).href);

  // Directly tests visible predicate across cases.
  assert.equal(visible(null), false);
  assert.equal(visible(undefined), false);

  const disconnected = makeFakeElement({ isConnected: false });
  assert.equal(visible(disconnected), false);

  const zeroWidth = makeFakeElement({ width: 0, height: 20 });
  assert.equal(visible(zeroWidth), false);

  const zeroHeight = makeFakeElement({ width: 20, height: 0 });
  assert.equal(visible(zeroHeight), false);

  const hiddenSelf = makeFakeElement({ hidden: true });
  assert.equal(visible(hiddenSelf), false);

  const hiddenParent = makeFakeElement({ hidden: true });
  const childOfHidden = makeFakeElement({ parentElement: hiddenParent });
  assert.equal(visible(childOfHidden), false);

  const hiddenGrandparent = makeFakeElement({ hidden: true });
  const midParent = makeFakeElement({ hidden: false, parentElement: hiddenGrandparent });
  const childOfGrandparent = makeFakeElement({ hidden: false, parentElement: midParent });
  assert.equal(visible(childOfGrandparent), false);

  const validEl1 = makeFakeElement({ width: 100, height: 30 });
  assert.equal(visible(validEl1), true);

  const validParent = makeFakeElement({ hidden: false });
  const validEl2 = makeFakeElement({ width: 50, height: 50, parentElement: validParent });
  assert.equal(visible(validEl2), true);

  // Tests stopsFor filtering matching elements.
  const testStops = [
    { id: 'missing', selector: '#missing', view: null, morph: 'x', line: 'Missing' },
    { id: 'hidden', selector: '#hidden', view: null, morph: 'x', line: 'Hidden' },
    { id: 'gp-hidden', selector: '#gp-hidden', view: null, morph: 'x', line: 'Grandparent hidden' },
    { id: 'zero-w', selector: '#zero-w', view: null, morph: 'x', line: 'Zero width' },
    { id: 'zero-h', selector: '#zero-h', view: null, morph: 'x', line: 'Zero height' },
    { id: 'discon', selector: '#discon', view: null, morph: 'x', line: 'Disconnected' },
    { id: 'valid1', selector: '#valid1', view: 'home', morph: 'a', line: 'Valid 1' },
    { id: 'valid2', selector: '#valid2', view: 'ide', morph: 'b', line: 'Valid 2' },
  ];

  const map: Record<string, any> = {
    '#missing': null,
    '#hidden': hiddenSelf,
    '#gp-hidden': childOfGrandparent,
    '#zero-w': zeroWidth,
    '#zero-h': zeroHeight,
    '#discon': disconnected,
    '#valid1': validEl1,
    '#valid2': validEl2,
  };

  const doc = {
    querySelector: (sel: string) => (sel in map ? map[sel] : null),
  };

  const filtered = stopsFor(doc, testStops);
  assert.deepEqual(filtered, [testStops[6], testStops[7]]);

  // Verifies total and label in createTour reflect filtered stops.
  let curView = 'home';
  const tour = createTour({
    doc,
    stops: testStops,
    getView: () => curView,
    setView: (v: string) => { curView = v; },
    onEnd: () => {},
  });

  assert.equal(tour.total, 2);
  tour.start();
  assert.equal(tour.label(), '1 of 2');
  tour.next();
  assert.equal(tour.label(), '2 of 2');
});

// protects=createTour switches view only when stop view differs and restores initial view for null view stops and upon tour termination
// fails_when=setView is invoked when view already matches or fails to restore starting view for null view stops or at end
// no_claim=animation or timing during view transition
test('8. View switching and restoration', async () => {
  const { createTour } = await import(new URL('../ui/src/tour.js', import.meta.url).href);
  const el1 = makeFakeElement();
  const el2 = makeFakeElement();
  const el3 = makeFakeElement();
  const el4 = makeFakeElement();
  const doc = {
    querySelector: (sel: string) => {
      if (sel === '#s1') return el1;
      if (sel === '#s2') return el2;
      if (sel === '#s3') return el3;
      if (sel === '#s4') return el4;
      return null;
    },
  };
  const stops = [
    { id: 's1', selector: '#s1', view: 'wall', morph: 'a', line: 'Stop wall' },
    { id: 's2', selector: '#s2', view: 'ide', morph: 'b', line: 'Stop ide' },
    { id: 's3', selector: '#s3', view: 'ide', morph: 'c', line: 'Stop ide again' },
    { id: 's4', selector: '#s4', view: null, morph: 'd', line: 'Stop null view' },
  ];
  let curView = 'wall';
  const viewCalls: string[] = [];
  const tour = createTour({
    doc,
    stops,
    getView: () => curView,
    setView: (v: string) => {
      viewCalls.push(v);
      curView = v;
    },
    onEnd: () => {},
  });

  // Verifies tour start in matching view does not call setView.
  tour.start();
  assert.deepEqual(viewCalls, []);

  // Verifies advancing to different view calls setView.
  tour.next();
  assert.equal(curView, 'ide');
  assert.deepEqual(viewCalls, ['ide']);

  // Verifies advancing to matching view does not call setView again.
  tour.next();
  assert.equal(curView, 'ide');
  assert.deepEqual(viewCalls, ['ide']);

  // Verifies advancing to null-view stop restores initial view.
  tour.next();
  assert.equal(curView, 'wall');
  assert.deepEqual(viewCalls, ['ide', 'wall']);

  // Verifies ending tour when already in startView does not call setView again.
  tour.next();
  assert.deepEqual(viewCalls, ['ide', 'wall']);
  assert.equal(curView, 'wall');
  assert.equal(tour.active, false);
});

// protects=createTour with zero visible stops ends immediately and triggers onEnd callback once
// fails_when=tour becomes active when total is zero or onEnd fails to fire exactly once
// no_claim=rendering empty notification bubbles
test('9. Zero visible stops: start ends immediately and triggers onEnd once', async () => {
  const { createTour } = await import(new URL('../ui/src/tour.js', import.meta.url).href);
  const doc = {
    querySelector: () => null,
  };
  const stops = [
    { id: 's1', selector: '#s1', view: 'home', morph: 'a', line: 'Unreachable' },
  ];
  let ended = 0;
  const tour = createTour({
    doc,
    stops,
    getView: () => 'home',
    setView: () => {},
    onEnd: () => { ended++; },
  });

  assert.equal(tour.total, 0);
  tour.start();
  assert.equal(tour.active, false);
  assert.equal(ended, 1);

  tour.next();
  tour.skip();
  assert.equal(ended, 1);
});

// protects=menuItems returns expected action identifiers for unconfigured signed out and signed in states with manage flag
// fails_when=menuItems deviates from specified lists exposes signin when unconfigured or includes manage when false or missing
// no_claim=visual rendering and placement of dropdown menu items
test('10. menuItems returns correct actions across configuration and sign in states', async () => {
  const { menuItems } = await import(new URL('../ui/src/tour.js', import.meta.url).href);

  // Verifies not configured states always produce only tour.
  assert.deepEqual(menuItems({ configured: false, status: { signed_in: true }, pro: true }), ['tour']);
  assert.deepEqual(menuItems({ configured: false, status: { signed_in: false }, pro: false }), ['tour']);
  assert.deepEqual(menuItems({ configured: false, status: null, pro: false }), ['tour']);

  // Verifies configured and signed out states produce signin and tour.
  assert.deepEqual(menuItems({ configured: true, status: { signed_in: false }, pro: false }), ['signin', 'tour']);
  assert.deepEqual(menuItems({ configured: true, status: { signed_in: null }, pro: false }), ['signin', 'tour']);
  assert.deepEqual(menuItems({ configured: true, status: {}, pro: false }), ['signin', 'tour']);

  // Verifies configured and signed in states with manage true produce complete menu item list.
  assert.deepEqual(menuItems({ configured: true, status: { signed_in: true }, pro: false, manage: true }), ['who', 'manage', 'plan', 'tour', 'signout']);
  assert.deepEqual(menuItems({ configured: true, status: { signed_in: true }, pro: true, manage: true }), ['who', 'manage', 'plan', 'tour', 'signout']);

  // Verifies configured and signed in states with manage false or missing omit manage item.
  assert.deepEqual(menuItems({ configured: true, status: { signed_in: true }, pro: false, manage: false }), ['who', 'plan', 'tour', 'signout']);
  assert.deepEqual(menuItems({ configured: true, status: { signed_in: true }, pro: true, manage: false }), ['who', 'plan', 'tour', 'signout']);
  assert.deepEqual(menuItems({ configured: true, status: { signed_in: true }, pro: false }), ['who', 'plan', 'tour', 'signout']);
  assert.deepEqual(menuItems({ configured: true, status: { signed_in: true }, pro: true }), ['who', 'plan', 'tour', 'signout']);
});

// protects=profileOf strips tokens and subject identifier while retaining user profile fields
// fails_when=sensitive authentication tokens leak into profile or missing fields are initialized
// no_claim=formatting or sanitization of name email and picture strings
test('11. profileOf drops authentication tokens and preserves profile attributes', async () => {
  const { profileOf } = await import(new URL('../ui/src/tour.js', import.meta.url).href);

  const full = {
    signed_in: true,
    name: 'Wasif Zaman',
    email: 'wasif@example.com',
    picture: 'https://example.com/avatar.png',
    access_token: 'secret-access',
    refresh_token: 'secret-refresh',
    id_token: 'secret-id',
    sub: 'user_123',
    extra_field: 'discarded',
  };
  const profile = profileOf(full);
  assert.deepEqual(profile, {
    signed_in: true,
    name: 'Wasif Zaman',
    email: 'wasif@example.com',
    picture: 'https://example.com/avatar.png',
  });

  const partial = profileOf({ signed_in: false, email: 'user@example.com' });
  assert.deepEqual(partial, { signed_in: false, email: 'user@example.com' });
  assert.equal(Object.prototype.hasOwnProperty.call(partial, 'name'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(partial, 'picture'), false);
});

// protects=planLabel outputs Plan Pro when pro is true and Plan Free otherwise
// fails_when=planLabel returns incorrect string for truthy or falsy inputs
// no_claim=handling custom paid tier labels
test('12. planLabel formats pro status label', async () => {
  const { planLabel } = await import(new URL('../ui/src/tour.js', import.meta.url).href);
  assert.equal(planLabel(true), 'Plan: Pro');
  assert.equal(planLabel(false), 'Plan: Free');
  assert.equal(planLabel(undefined), 'Plan: Free');
  assert.equal(planLabel(null), 'Plan: Free');
});

// protects=STOPS definition contains thirteen stops in order with valid metadata and notify line without completed work phrasing
// fails_when=stop count order id set length limits selector requirements or notify line phrasing is violated
// no_claim=stop position coordinates or element existence in live DOM
test('13. STOPS array defines thirteen ordered stops with valid metadata', async () => {
  const { STOPS } = await import(new URL('../ui/src/tour.js', import.meta.url).href);

  assert.equal(Array.isArray(STOPS), true);
  assert.equal(STOPS.length, 13);
  const expectedIds = ['chat', 'access', 'needs', 'wall', 'palette', 'notify', 'ide', 'browser', 'computer', 'drawn', 'sessions', 'account', 'pro'];
  assert.deepEqual(STOPS.map((s: any) => s.id), expectedIds);

  for (const s of STOPS) {
    assert.equal(typeof s.id, 'string');
    assert.equal(typeof s.selector, 'string');
    assert.ok(s.view === null || ['home', 'ide', 'wall', 'inbox', 'addons'].includes(s.view));
    assert.equal(typeof s.morph, 'string');
    assert.equal(typeof s.line, 'string');
    assert.ok(s.line.length > 0, `line for stop ${s.id} is empty`);
    assert.ok(s.line.length < 100, `line for stop ${s.id} is too long`);
    assert.equal(s.line.includes('\u2014'), false, `line for stop ${s.id} contains em dash`);
  }

  // Verifies account stop uses id selector.
  const accountStop = STOPS.find((s: any) => s.id === 'account');
  assert.ok(accountStop, 'account stop found');
  assert.equal(accountStop.selector, '#account');

  // Verifies notify stop description does not reference completed work.
  const notifyStop = STOPS.find((s: any) => s.id === 'notify');
  assert.ok(notifyStop, 'notify stop found');
  assert.equal(notifyStop.line.includes('when work is done'), false);
});

// protects=createByte under reduced motion draws initial frame without requesting animation frames
// fails_when=raf is called or running returns true when reducedMotion is active
// no_claim=actual pixel rendering fidelity of the canvas shape
test('14. byte reduced motion renders once and stops animation loop', async () => {
  const { createByte } = await import(new URL('../ui/src/byte.js', import.meta.url).href);
  const fillCalls: string[] = [];
  const ctx = {
    fillStyle: '',
    fillRect(..._args: any[]) { fillCalls.push('fillRect'); },
    fill(..._args: any[]) { fillCalls.push('fill'); },
    beginPath() {},
    arc(..._args: any[]) {},
    clearRect(..._args: any[]) {},
  };
  const canvas = {
    width: 200,
    height: 200,
    getContext: (type: string) => (type === '2d' ? ctx : null),
  };
  let rafCalls = 0;
  const raf = (_fn: any) => ++rafCalls;
  const caf = (_id: number) => {};
  const color = () => '#112233';
  const now = () => 1000;

  const byte = createByte(canvas, { reducedMotion: true, color, raf, caf, now });
  assert.equal(rafCalls, 0);
  assert.equal(byte.running(), false);
  assert.ok(fillCalls.length > 0, 'initial frame rendered with at least one fill call');

  byte.morph('hi', 300);
  assert.equal(rafCalls, 0);
  byte.moveTo(10, 20);
  assert.equal(rafCalls, 0);
  assert.equal(byte.running(), false);
});

// protects=createByte animated loop schedules animation frames via raf and cancels pending frame on stop
// fails_when=raf is not scheduled on creation or frame callback or caf is not invoked upon stop
// no_claim=exact easing curve values between frames
test('15. byte animated schedules raf loop and cancels on stop', async () => {
  const { createByte } = await import(new URL('../ui/src/byte.js', import.meta.url).href);
  let nextId = 1;
  const cbs = new Map<number, (time: number) => void>();
  let lastCaf: number | null = null;
  const raf = (fn: (time: number) => void) => {
    const id = nextId++;
    cbs.set(id, fn);
    return id;
  };
  const caf = (id: number) => {
    lastCaf = id;
    cbs.delete(id);
  };
  const ctx = {
    fillStyle: '',
    fillRect() {},
    fill() {},
    beginPath() {},
    arc() {},
    clearRect() {},
  };
  const canvas = {
    width: 200,
    height: 200,
    getContext: (type: string) => (type === '2d' ? ctx : null),
  };

  const byte = createByte(canvas, {
    reducedMotion: false,
    color: () => '#fff',
    raf,
    caf,
    now: () => 1000,
  });

  assert.equal(cbs.size, 1);
  assert.equal(nextId, 2);
  assert.equal(byte.running(), true);

  const cb1 = cbs.get(1)!;
  cb1(1016);
  assert.equal(nextId, 3);

  const cb2 = cbs.get(2)!;
  cb2(1032);
  assert.equal(nextId, 4);

  byte.stop();
  assert.equal(lastCaf, 3);
  assert.equal(byte.running(), false);

  const countBefore = nextId;
  cb2(1048);
  assert.equal(nextId, countBefore);
});

// protects=createByte reads color dynamically on each frame to update canvas fillStyle
// fails_when=ctx fillStyle does not reflect updated color function value on subsequent frame
// no_claim=alpha transparency blending behavior
test('16. byte colour updates fillStyle dynamically per frame', async () => {
  const { createByte } = await import(new URL('../ui/src/byte.js', import.meta.url).href);
  let currentColor = '#111';
  let nextId = 1;
  const cbs = new Map<number, (time: number) => void>();
  const raf = (fn: (time: number) => void) => {
    const id = nextId++;
    cbs.set(id, fn);
    return id;
  };
  const caf = (id: number) => { cbs.delete(id); };

  let activeFillStyle = '';
  const ctx = {
    set fillStyle(val: string) { activeFillStyle = val; },
    get fillStyle() { return activeFillStyle; },
    fillRect() {},
    fill() {},
    beginPath() {},
    arc() {},
    clearRect() {},
  };
  const canvas = {
    width: 200,
    height: 200,
    getContext: (type: string) => (type === '2d' ? ctx : null),
  };

  const byte = createByte(canvas, {
    reducedMotion: false,
    color: () => currentColor,
    raf,
    caf,
    now: () => 1000,
  });

  assert.equal(ctx.fillStyle, '#111');

  currentColor = '#eee';
  const cb = cbs.get(1);
  assert.ok(cb, 'frame callback exists');
  cb(1016);
  assert.equal(ctx.fillStyle, '#eee');
  byte.stop();
});

// protects=main.ts registers auth methods in UI_METHODS and validates setTour input against allowed values
// fails_when=auth methods are missing from UI_METHODS or setTour handler lacks validation and settings write
// no_claim=actual IPC transport over Electron ipcMain
test('17. main.ts UI_METHODS and setTour handler', () => {
  const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

  const uiMethodsMatch = mainSource.match(/UI_METHODS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(uiMethodsMatch, 'UI_METHODS Set block found in main.ts');
  const uiMethodsBody = uiMethodsMatch[1];
  assert.ok(uiMethodsBody.includes("'auth.signIn'") || uiMethodsBody.includes('"auth.signIn"'), 'UI_METHODS contains auth.signIn');
  assert.ok(uiMethodsBody.includes("'auth.status'") || uiMethodsBody.includes('"auth.status"'), 'UI_METHODS contains auth.status');
  assert.ok(uiMethodsBody.includes("'auth.signOut'") || uiMethodsBody.includes('"auth.signOut"'), 'UI_METHODS contains auth.signOut');

  const setTourMatch = mainSource.match(/on\(\s*['"]setTour['"]\s*,\s*([\s\S]*?)\n\s*\);/);
  assert.ok(setTourMatch, 'setTour IPC handler found in main.ts');
  const setTourBody = setTourMatch[1];
  assert.ok(setTourBody.includes("'done'") || setTourBody.includes('"done"'), 'setTour handler references done');
  assert.ok(setTourBody.includes("'later'") || setTourBody.includes('"later"'), 'setTour handler references later');
  assert.ok(setTourBody.includes("'ui.tour'") || setTourBody.includes('"ui.tour"'), 'setTour handler references ui.tour');
  assert.ok(/error\s*:/.test(setTourBody), 'setTour handler returns error branch');
});

// protects=settings.ts default configuration initializes ui.tour to empty string
// fails_when=DEFAULTS ui block omits tour or sets default value other than empty string
// no_claim=settings schema migration across versions
test('18. settings.ts ui defaults include tour', () => {
  const settingsSource = readFileSync(new URL('../../core/src/settings.ts', import.meta.url), 'utf8');
  const uiDefaultsMatch = settingsSource.match(/ui\s*:\s*\{([\s\S]*?)\n\s*themes\s*:/);
  assert.ok(uiDefaultsMatch, 'ui defaults block found in settings.ts');
  const uiDefaultsBody = uiDefaultsMatch[1];
  assert.ok(/tour\s*:\s*['"]['"]/.test(uiDefaultsBody), "ui defaults contains tour: ''");
});

// protects=index.html defines account button as the last child button in the rail footer
// fails_when=account button is absent or not positioned as the last button in .ffoot
// no_claim=css icon styling or layout dimensions of the button
test('19. index.html account button in ffoot', () => {
  const htmlSource = readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const ffootMatch = htmlSource.match(/<div class="ffoot">([\s\S]*?)<\/div>/);
  assert.ok(ffootMatch, '.ffoot container found in index.html');
  const ffootContent = ffootMatch[1];
  const buttonMatches = [...ffootContent.matchAll(/<button\b([^>]*)>/g)];
  assert.ok(buttonMatches.length > 0, '.ffoot contains buttons');
  const lastButtonAttrs = buttonMatches[buttonMatches.length - 1][1];
  assert.ok(/\bid="account"/.test(lastButtonAttrs), 'last button has id="account"');
  assert.ok(/\bdata-action="account"/.test(lastButtonAttrs), 'last button has data-action="account"');
});

// protects=null-view stop restores initial view when tour started in a different view
// fails_when=advancing to null-view stop fails to call setView with starting view
// no_claim=visual transition styling during view restoration
test('20. null-view stop restores initial view upon entry', async () => {
  const { createTour } = await import(new URL('../ui/src/tour.js', import.meta.url).href);
  const el1 = makeFakeElement();
  const el2 = makeFakeElement();
  const doc = {
    querySelector: (sel: string) => {
      if (sel === '#s1') return el1;
      if (sel === '#s2') return el2;
      return null;
    },
  };
  const stops = [
    { id: 's1', selector: '#s1', view: 'ide', morph: 'a', line: 'IDE stop' },
    { id: 's2', selector: '#s2', view: null, morph: 'b', line: 'Null view stop' },
  ];
  let curView = 'home';
  const viewCalls: string[] = [];
  const tour = createTour({
    doc,
    stops,
    getView: () => curView,
    setView: (v: string) => {
      viewCalls.push(v);
      curView = v;
    },
    onEnd: () => {},
  });

  // Verifies tour start switches to first stop view.
  tour.start();
  assert.equal(curView, 'ide');
  assert.deepEqual(viewCalls, ['ide']);

  // Verifies advancing to null-view stop restores starting view via setView.
  tour.next();
  assert.equal(curView, 'home');
  assert.deepEqual(viewCalls, ['ide', 'home']);
});

// protects=STOPS selectors for data-view stops are scoped to a container and do not match root html element
// fails_when=selector for needs wall ide or pro starts with open bracket
// no_claim=specific container selector or class name used to scope the element
test('21. STOPS selectors for view stops do not match root html element', async () => {
  const { STOPS } = await import(new URL('../ui/src/tour.js', import.meta.url).href);

  // Verifies selectors for data-view stops do not start with open bracket.
  const needsStop = STOPS.find((s: any) => s.id === 'needs');
  assert.ok(needsStop, 'needs stop found');
  assert.equal(needsStop.selector.startsWith('['), false);

  const wallStop = STOPS.find((s: any) => s.id === 'wall');
  assert.ok(wallStop, 'wall stop found');
  assert.equal(wallStop.selector.startsWith('['), false);

  const ideStop = STOPS.find((s: any) => s.id === 'ide');
  assert.ok(ideStop, 'ide stop found');
  assert.equal(ideStop.selector.startsWith('['), false);

  const proStop = STOPS.find((s: any) => s.id === 'pro');
  assert.ok(proStop, 'pro stop found');
  assert.equal(proStop.selector.startsWith('['), false);
});
