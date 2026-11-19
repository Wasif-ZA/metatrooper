// protects=byte canvas resolves light-dark color tokens into browser-computed rgb values for dot rendering
// fails_when=dot fillStyle receives unresolved light-dark string or fails to match computed rgb color
// no_claim=pixel layout and motion easing curves of byte canvas animation
import test from 'node:test';
import assert from 'node:assert/strict';

function createFakeStyle() {
  let colorVal = '';
  let hadTextPrimary = false;
  let hadBgBody = false;

  function setColor(val: string) {
    colorVal = String(val ?? '');
    if (colorVal.includes('var(')) {
      if (colorVal.includes('--color-text-primary')) hadTextPrimary = true;
      if (colorVal.includes('--color-background-body')) hadBgBody = true;
    }
  }

  return {
    get color() {
      return colorVal;
    },
    set color(val: string) {
      setColor(val);
    },
    get cssText() {
      return colorVal ? `color: ${colorVal};` : '';
    },
    set cssText(val: string) {
      const match = /color:\s*([^;]+)/.exec(String(val ?? ''));
      if (match) setColor(match[1].trim());
    },
    setProperty(prop: string, val: string) {
      if (prop === 'color') setColor(val);
    },
    getPropertyValue(prop: string) {
      if (prop === 'color') return colorVal;
      return '';
    },
    get _hadTextPrimary() {
      return hadTextPrimary;
    },
    get _hadBgBody() {
      return hadBgBody;
    },
  };
}

test('byte resolves light-dark custom property for dots fill colour', async () => {
  const { createByte } = await import(new URL('../ui/src/byte.js', import.meta.url).href);

  const fakeWin: any = {
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    performance: { now: () => 1000 },
    getComputedStyle(x: any) {
      const rawColor = typeof x?.style?.color === 'string' ? x.style.color : '';
      const hasTextPrimary = Boolean(
        x?.style?._hadTextPrimary ||
        x?._hadTextPrimary ||
        (rawColor.includes('var(') && rawColor.includes('--color-text-primary'))
      );
      const hasBgBody = Boolean(
        x?.style?._hadBgBody ||
        x?._hadBgBody ||
        (rawColor.includes('var(') && rawColor.includes('--color-background-body'))
      );

      const resolvedColor = hasTextPrimary
        ? 'rgb(232, 234, 237)'
        : hasBgBody
          ? 'rgb(17, 17, 17)'
          : rawColor;

      return {
        get color() {
          return resolvedColor;
        },
        getPropertyValue(prop: string) {
          if (prop === '--color-text-primary') {
            return 'light-dark(#0F1419, #E8EAED)';
          }
          if (prop === '--color-background-body') {
            return 'light-dark(#FFFFFF, #111111)';
          }
          if (prop === 'color') {
            return resolvedColor;
          }
          return '';
        },
      };
    },
  };

  const fakeBody = {
    appendChild: (child: any) => child,
    removeChild: (child: any) => child,
    style: createFakeStyle(),
  };

  const fakeDoc = {
    defaultView: fakeWin,
    body: fakeBody,
    createElement(tag: string) {
      return {
        tagName: tag.toUpperCase(),
        style: createFakeStyle(),
        ownerDocument: fakeDoc,
        parentElement: fakeBody,
      };
    },
  };
  fakeWin.document = fakeDoc;

  let activeFillStyle = '';
  const fills: string[] = [];
  const ctx = {
    get fillStyle() {
      return activeFillStyle;
    },
    set fillStyle(val: string) {
      activeFillStyle = val;
    },
    setTransform(..._args: any[]) {},
    clearRect(..._args: any[]) {},
    beginPath() {},
    arc(..._args: any[]) {},
    ellipse(..._args: any[]) {},
    fill(..._args: any[]) {
      fills.push(activeFillStyle);
    },
    fillRect(..._args: any[]) {},
  };

  const canvas = {
    width: 200,
    height: 200,
    style: createFakeStyle(),
    ownerDocument: fakeDoc,
    parentElement: fakeBody,
    getContext: (type: string) => (type === '2d' ? ctx : null),
  };

  const byte = createByte(canvas);
  byte.stop();

  assert.ok(fills.length > 0, 'expected dots to be rendered to canvas');
  const dotFill = fills[0];
  assert.equal(dotFill.includes('light-dark'), false, `dots fill colour must not be a light-dark(...) string, got: ${dotFill}`);
  assert.equal(dotFill, 'rgb(232, 234, 237)');
});
