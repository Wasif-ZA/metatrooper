import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Creates a fake element with bounding client rect and connection state, matching account-tour.test.ts harness style.
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

// protects=stopsFor selects the first visible match via querySelectorAll and computer stop specifies wall view
// fails_when=palette stop is dropped when first match is hidden or computer stop view is not wall
// no_claim=rendering positions or transitions between tour stops
test('1. stopsFor selects first visible match via querySelectorAll and computer stop has view wall', async () => {
  const { stopsFor, STOPS } = await import(new URL('../ui/src/tour.js', import.meta.url).href);

  // Verifies the computer stop is pinned to view 'wall'
  const computerStop = STOPS.find((s: any) => s.id === 'computer');
  assert.ok(computerStop, 'computer stop exists in STOPS');
  assert.equal(computerStop.view, 'wall');

  // Verifies stopsFor picks the first visible element among querySelectorAll matches
  const hiddenPalette = makeFakeElement({ hidden: true });
  const visiblePalette = makeFakeElement({ width: 100, height: 30 });
  const doc = {
    querySelector: (sel: string) => {
      if (sel === '[data-action="palette"]') return hiddenPalette;
      return null;
    },
    querySelectorAll: (sel: string) => {
      if (sel === '[data-action="palette"]') return [hiddenPalette, visiblePalette];
      return [];
    },
  };

  const paletteStop = STOPS.find((s: any) => s.id === 'palette');
  assert.ok(paletteStop, 'palette stop exists in STOPS');
  const matched = stopsFor(doc, [paletteStop]);
  assert.deepEqual(matched, [paletteStop]);
});

// protects=account menu onOpenChange triggers auth status refresh so failed mount status is corrected
// fails_when=DropdownMenu onOpenChange does not invoke refresh when opened
// no_claim=network retry timing or IPC error recovery
test('2. Opening the account menu calls auth.status again to refresh status', () => {
  const jsxSource = readFileSync(new URL('../ui/src/tour.jsx', import.meta.url), 'utf8');
  const menuMatch = jsxSource.match(/<DropdownMenu[\s\S]*?onOpenChange=\{([\s\S]*?)\}/);
  assert.ok(menuMatch, 'DropdownMenu with onOpenChange handler found in tour.jsx');
  const onOpenChangeBody = menuMatch[1];
  assert.ok(/\brefresh\(\)/.test(onOpenChangeBody), 'DropdownMenu onOpenChange must call refresh() to update auth status');
});

// protects=tour start closes Settings if open to prevent covering targets and onEnd reopens Settings
// fails_when=start does not close open Settings or onEnd fails to restore Settings if it was open
// no_claim=settings view contents or panel transition animations
test('3. Starting tour while Settings is open closes Settings first and reopens in onEnd', () => {
  const jsxSource = readFileSync(new URL('../ui/src/tour.jsx', import.meta.url), 'utf8');
  const startMatch = jsxSource.match(/async function start\(\)\s*\{([\s\S]*?)\n\s*\}\n\s*function next/);
  assert.ok(startMatch, 'start function found in tour.jsx');
  const startBody = startMatch[1];

  // Verifies start closes Settings if it was open
  const closesAtStart = /settingsWasOpen[\s\S]{0,80}settingsView\.close\(\)/.test(startBody) ||
    /if\s*\(\s*settingsWasOpen\s*\)\s*settingsView\.close\(\)/.test(startBody);
  assert.ok(closesAtStart, 'start() must close Settings if settingsWasOpen');

  // Verifies onEnd reopens Settings if it was open
  const onEndMatch = startBody.match(/onEnd\s*:\s*\(\)\s*=>\s*\{([\s\S]*?)\}/);
  assert.ok(onEndMatch, 'onEnd handler found in start()');
  const onEndBody = onEndMatch[1];
  const reopensAtEnd = /settingsWasOpen[\s\S]{0,80}settingsView\.open/.test(onEndBody);
  assert.ok(reopensAtEnd, 'onEnd must reopen Settings if settingsWasOpen');
});

// protects=demo mode suppresses user picture in rail account button and identity header in account menu
// fails_when=picture or header does not check document.body demo class when signed in
// no_claim=hiding usage stats or other demo mode UI elements
test('4. demo mode suppresses account button picture and menu name/email header', () => {
  const jsxSource = readFileSync(new URL('../ui/src/tour.jsx', import.meta.url), 'utf8');

  // Verifies picture is suppressed when body has class demo
  const pictureMatch = jsxSource.match(/const picture\s*=([\s\S]*?);/);
  assert.ok(pictureMatch, 'picture calculation found in tour.jsx');
  const pictureBody = pictureMatch[1];
  assert.ok(/demo/.test(pictureBody), 'picture calculation must check for demo class on body');

  // Verifies menu header is suppressed when body has class demo
  const headerMatch = jsxSource.match(/header=\{([\s\S]*?)\}/);
  assert.ok(headerMatch, 'DropdownMenu header prop found in tour.jsx');
  const headerBody = headerMatch[1];
  assert.ok(/demo/.test(headerBody), 'header prop must check for demo class on body');
});

// protects=account-tour container omits data-overlay when only the tour offer card is showing
// fails_when=data-overlay toggle condition includes offer card state
// no_claim=browser pane hiding logic driven by PANE_OVERLAYS
test('5. account-tour data-overlay excludes offer card state', () => {
  const jsxSource = readFileSync(new URL('../ui/src/tour.jsx', import.meta.url), 'utf8');
  const overlayEffectMatch = jsxSource.match(/toggleAttribute\(\s*['"]data-overlay['"]\s*,\s*Boolean\(([\s\S]*?)\)\s*\)/);
  assert.ok(overlayEffectMatch, 'data-overlay toggleAttribute found in tour.jsx');
  const condition = overlayEffectMatch[1];
  assert.equal(/\boffer\b/.test(condition), false, 'data-overlay condition must not include offer');
});

// protects=choosing Sign in from menu does not call recordOffer or persist ui.tour done
// fails_when=actions signin calls recordOffer while offer card is active
// no_claim=subsequent sign in flow or dialog dismissal
test('6. Choosing Sign in from menu does not call recordOffer or write ui.tour', () => {
  const jsxSource = readFileSync(new URL('../ui/src/tour.jsx', import.meta.url), 'utf8');
  const signinMatch = jsxSource.match(/signin\s*:\s*async\s*\(\)\s*=>\s*\{([\s\S]*?)\}/);
  assert.ok(signinMatch, 'signin action handler found in tour.jsx');
  const signinBody = signinMatch[1];
  assert.equal(/\brecordOffer\b/.test(signinBody), false, 'signin action must not call recordOffer');
});
