import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../ui/src/settings.jsx', import.meta.url), 'utf8');
const fn = (name: string) => appSource.match(new RegExp(`^(?:async )?function ${name}\\([^]*?\\n}\\n`, 'm'))![0];
const sinkConstants = appSource.match(/const SINK_KINDS = [^]*?const SINK_DEST_HINT = \{[^]*?\};\n/m)![0];
const { SINK_KINDS, SINK_THIRD_PARTY } = new Function(
  `${sinkConstants}; return { SINK_KINDS, SINK_THIRD_PARTY };`
)() as { SINK_KINDS: string[]; SINK_THIRD_PARTY: Record<string, string> };

test('M8-F23d every sink kind has a third party disclosure', () => {
  // protects=M8-F23d: every available sink has a nonempty delivery disclosure.
  assert.ok(SINK_KINDS.length > 0);
  for (const kind of SINK_KINDS) {
    assert.ok(Object.hasOwn(SINK_THIRD_PARTY, kind), `missing disclosure for ${kind}`);
    assert.equal(typeof SINK_THIRD_PARTY[kind], 'string');
    assert.ok(SINK_THIRD_PARTY[kind].trim().length > 0, `empty disclosure for ${kind}`);
  }
});

test('M8-F23d the add sink form renders the ntfy third party disclosure', () => {
  // protects=M8-F23d: the default add form shows the ntfy disclosure in sink-third.
  let html = '';
  const ui = { sinks: [], sinkEdit: { kinds: ['gate'], enabled: true } };
  const renderSinks = new Function(
    'ui', 'setHtml',
    `${sinkConstants}\n${fn('esc')}\n${fn('renderSinks')}; return renderSinks;`
  )(ui, (id: string, value: string) => {
    assert.equal(id, 'sinks-list');
    html = value;
  });
  renderSinks();
  const note = html.match(/<p\b[^>]*\bid="sink-third"[^>]*>([^]*?)<\/p>/);
  assert.ok(note, 'add form contains id="sink-third"');
  assert.equal(note[1], SINK_THIRD_PARTY.ntfy);
  assert.match(note[1], /ntfy \(ntfy\.sh unless you name your own server\), a third party\./);
});

test('M8-F23b settings exposes notify.quiet_at_night as Never at night', () => {
  // protects=M8-F23b: the Never at night settings row binds the persisted quiet-hours key.
  assert.match(settingsSource, /\{\s*key:\s*'notify\.quiet_at_night',\s*label:\s*'Never at night'[^}]*\}/);
});
