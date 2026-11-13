import { useEffect, useRef } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Code } from '@astryxdesign/core/Code';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Step, Stepper } from '@astryxdesign/core/Stepper';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { openDiff, patchSides } from '../editor.js';
import { MAX_ROWS } from './check.js';
import { Plain } from './Draw.jsx';
import './parts-e.css';

const isStr = (v) => typeof v === 'string' || typeof v === 'number';
const need = (v) => { if (!isStr(v)) throw new Error('bad'); return String(v); };
const maybe = (v) => (v == null ? undefined : need(v));
const obj = (v) => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('bad'); return v; };
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const pct = (v) => Math.max(0, Math.min(100, num(v, 0)));
const own = (map, v, d) => (typeof v === 'string' && Object.hasOwn(map, v) ? map[v] : d);
const textOf = (x) => { try { const s = String(JSON.stringify(x, null, 1)); return s.length > 400 ? `${s.slice(0, 400)} ...` : s; } catch { return '(unreadable input)'; } };
const bad = (name, x, i) => <Plain key={`bad${i}`} f={{ name, why: `bad item ${i + 1}`, text: textOf(x) }} />;

/** Maps each item through f; an item f throws on becomes a Plain box, kept apart so astryx containers only get good items. */
function split(a, name, f, cap = MAX_ROWS) {
  const good = [];
  const out = [];
  a.slice(0, cap).forEach((x, i) => { try { good.push(f(x, i)); } catch { out.push(bad(name, x, i)); } });
  return [good, out];
}

const Head = ({ title, note }) => (title == null && note == null ? null : (
  <div className="ou-pe-head"><Text type="label">{String(title ?? '')}</Text>{note == null ? null : <Text color="secondary" size="sm">{String(note)}</Text>}</div>
));

// needs maps to accent, not warning: agent screens never draw the needs-you orange.
const PIPE = { done: 'success', cur: 'accent', needs: 'accent', failed: 'error', todo: undefined };
const KIND = { step: '', gate: 'gate', fanout: 'fan-out', loop: 'loop' };

function Pipe({ p }) {
  const [nodes, out] = split(p.nodes, 'pipe', (x) => {
    const state = typeof obj(x).state === 'string' && Object.hasOwn(PIPE, x.state) ? x.state : 'todo';
    const sub = [maybe(x.value), own(KIND, x.kind, '')].filter(Boolean).join(' · ');
    return { title: need(x.title), state, sub: sub || undefined };
  }, 24);
  let active = nodes.findIndex((n) => n.state === 'cur' || n.state === 'needs');
  if (active < 0) active = nodes.findIndex((n) => n.state === 'todo');
  if (active < 0) active = nodes.length;
  return (
    <VStack gap={2}>
      <Head title={p.title} note={p.note} />
      {nodes.length ? (
        <Stepper label={String(p.title ?? 'Pipeline')} activeStep={active} density="compact">
          {nodes.map((n, k) => <Step key={k} step={k} label={n.title} description={n.state === 'needs' ? [n.sub, 'waiting'].filter(Boolean).join(' · ') : n.sub} status={PIPE[n.state]} />)}
        </Stepper>
      ) : null}
      {out}
    </VStack>
  );
}

const SPAN = { ok: 'ok', fail: 'fail', run: 'run', cut: 'cut', none: 'none' };

function Timeline({ p }) {
  const [tracks, out] = split(p.tracks, 'timeline', (t) => {
    const label = need(obj(t).label);
    if (!Array.isArray(t.spans)) throw new Error('bad');
    const spans = t.spans.slice(0, MAX_ROWS).filter((s) => s && typeof s === 'object').map((s) => {
      const start = pct(s.start);
      return { start, len: Math.max(0.5, Math.min(100 - start, num(s.len, 0))), state: own(SPAN, s.state, 'none'), label: isStr(s.label) ? String(s.label) : undefined };
    });
    return { label, spans };
  });
  const scale = Array.isArray(p.scale) ? p.scale.filter(isStr).slice(0, 24).map(String) : [];
  const head = Number.isFinite(p.playhead) ? pct(p.playhead) : null;
  return (
    <VStack gap={1}>
      {scale.length ? <div className="ou-pe-tl"><span /><div className="ou-pe-scale">{scale.map((s, i) => <Text key={i} color="secondary" size="sm">{s}</Text>)}</div></div> : null}
      <List hasDividers>
        {tracks.map((t, i) => (
          <ListItem key={i} label={
            <span className="ou-pe-tl">
              <Text>{t.label}</Text>
              <span className="ou-pe-lane">
                {t.spans.map((s, k) => <i key={k} className={`ou-pe-span ou-pe-${s.state}`} style={{ left: `${s.start}%`, width: `${s.len}%` }} title={s.label} />)}
                {head == null ? null : <b className="ou-pe-play" style={{ left: `${head}%` }} />}
              </span>
            </span>
          } />
        ))}
      </List>
      {out}
    </VStack>
  );
}

function Trace({ p }) {
  const [frames, out] = split(p.frames, 'trace', (f) => ({ fn: need(obj(f).fn), at: `${need(f.file)}${f.line == null ? '' : `:${need(f.line)}`}`, internal: f.internal === true }), 12);
  return (
    <Card padding={3}>
      <VStack gap={2}>
        <HStack gap={2}><StatusDot variant="error" label="error" /><Text className="ou-pe-err">{need(p.error)}</Text>{p.msg == null ? null : <Text color="secondary">{String(p.msg)}</Text>}</HStack>
        <VStack gap={1}>
          {frames.map((f, i) => <Text key={i} size="sm" color={f.internal ? 'secondary' : 'primary'}>at <Code color={f.internal ? 'secondary' : 'primary'}>{f.fn}</Code> <Code color="secondary">{f.at}</Code></Text>)}
        </VStack>
        {p.frames.length > 12 ? <Text color="secondary" size="sm">{`${p.frames.length - 12} more frames not drawn`}</Text> : null}
        {out}
      </VStack>
    </Card>
  );
}

function Monaco({ sides, lang, rows }) {
  const ref = useRef(null);
  const { original, modified } = sides;
  useEffect(() => {
    const h = openDiff(ref.current, { original, modified }, `x.${lang}`);
    return () => h.dispose();
  }, [original, modified, lang]);
  return <div ref={ref} className="ou-pe-diff" style={{ height: `${Math.min(rows, 24) * 19 + 12}px` }} />;
}

function Diff({ p }) {
  const path = need(p.path);
  const [hunks, out] = split(p.hunks, 'diff', (h) => {
    need(obj(h).head);
    const lines = (h.lines ?? []).slice(0, MAX_ROWS).map((l) => { const s = need(l); return /^[ +-]/.test(s) ? s : ` ${s}`; });
    return `@@ -1 +1 @@\n${lines.join('\n')}`;
  }, 40);
  const sides = hunks.length ? patchSides(hunks.join('\n'), null) : null;
  const rows = hunks.join('\n').split('\n').length - hunks.length;
  const m = /\.([a-z]{1,4})$/i.exec(path);
  const actions = Array.isArray(p.actions) ? p.actions.slice(0, 6) : [];
  return (
    <Card padding={0}>
      <div className="ou-pe-diffhead">
        <Text type="label">{path}</Text>
        {p.add == null ? null : <Text size="sm" className="ou-pe-add">{String(p.add)}</Text>}
        {p.del == null ? null : <Text size="sm" className="ou-pe-del">{String(p.del)}</Text>}
        <span className="ou-pe-grow" />
        {actions.map((a, i) => (a && isStr(a.label) ? <Button key={i} label={String(a.label)} variant={a.primary ? 'primary' : 'secondary'} size="sm" /> : bad('diff action', a, i)))}
        {typeof p.viewed === 'boolean' ? <Badge variant={p.viewed ? 'success' : 'neutral'} label={p.viewed ? 'Viewed' : 'Not viewed'} /> : null}
      </div>
      {sides ? <Monaco sides={sides} lang={m ? m[1].toLowerCase() : 'txt'} rows={rows} /> : null}
      {out}
    </Card>
  );
}

export default { pipe: Pipe, timeline: Timeline, trace: Trace, diff: Diff };
