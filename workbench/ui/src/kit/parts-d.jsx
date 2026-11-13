import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Text } from '@astryxdesign/core/Text';
import { fallback } from './check.js';
import { Plain } from './Draw.jsx';
import './parts-d.css';

const S = (v) => String(v);
const isStr = (v) => typeof v === 'string' || typeof v === 'number';
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const pick = (map, v, d) => (typeof v === 'string' && Object.hasOwn(map, v) ? map[v] : d);
const num = (x) => Number.isFinite(x) && x >= 0;

const INK = 'var(--ink)';
const MUTE = 'var(--mute)';
const LINE = 'var(--hairline)';
const SERIES = [INK, MUTE, 'var(--st-run)', 'var(--st-review)'];
const SHARE = [INK, MUTE, 'var(--st-run)', 'var(--st-review)', 'var(--st-ok)', 'var(--st-other)', 'var(--st-bad)', 'var(--hairline-strong)'];
// "need" is left out on purpose: agent screens never draw the needs-you colour.
const BAR_TONE = { fail: 'var(--st-bad)', lead: INK };
const CELL = { ok: 'ou-pd-ok', fail: 'ou-pd-fail', run: 'ou-pd-run', none: 'ou-pd-none' };
const AXIS = { stroke: LINE, tick: { fill: MUTE, fontSize: 11 }, tickLine: false };
const TIP = { contentStyle: { background: 'var(--canvas)', border: '1px solid var(--hairline)', borderRadius: 4, fontSize: 12 }, labelStyle: { color: 'var(--ink)' }, itemStyle: { color: 'var(--ink)' }, cursor: { fill: 'var(--canvas-soft)' } };
const MARGIN = { top: 6, right: 8, bottom: 0, left: 0 };

function Caption({ p }) {
  if (!isStr(p.title)) return null;
  return <figcaption className="ou-pd-cap"><Text type="label">{S(p.title)}</Text>{isStr(p.unit) ? <Text color="secondary" size="sm">{S(p.unit)}</Text> : null}</figcaption>;
}

function Key({ items }) {
  return <div className="ou-pd-key">{items.map(([name, colour], i) => <span key={i}><i className="ou-pd-sw" style={{ background: colour }} /><Text color="secondary" size="sm">{name}</Text></span>)}</div>;
}

function Share({ p, labels }) {
  const s = p.series[0];
  const vals = isObj(s) && Array.isArray(s.values) ? s.values : null;
  if (!vals || vals.length < labels.length || !vals.slice(0, labels.length).every(num)) return <Plain f={fallback(p, 'bad share values')} />;
  const data = labels.slice(0, 8).map((name, i) => ({ name, v: vals[i] }));
  const sum = data.reduce((a, d) => a + d.v, 0) || 1;
  return (
    <figure className="ou-pd-chart">
      <Caption p={p} />
      <div className="ou-pd-share">
        <PieChart width={140} height={140}>
          <Pie data={data} dataKey="v" nameKey="name" innerRadius={42} outerRadius={64} stroke="var(--canvas)" strokeWidth={2} isAnimationActive={false}>
            {data.map((_, i) => <Cell key={i} fill={SHARE[i]} />)}
          </Pie>
          <Tooltip {...TIP} />
        </PieChart>
        <Key items={data.map((d, i) => [`${d.name} ${Math.round((d.v / sum) * 100)}%`, SHARE[i]])} />
      </div>
    </figure>
  );
}

function chart({ p }) {
  const labels = p.labels.slice(0, 24).map((l) => (isStr(l) ? S(l) : '?'));
  if (p.kind === 'share') return <Share p={p} labels={labels} />;
  const good = [];
  const bad = [];
  for (const s of p.series.slice(0, 4)) {
    if (isObj(s) && isStr(s.name) && Array.isArray(s.values) && s.values.length >= labels.length && s.values.slice(0, labels.length).every(num)) good.push({ name: S(s.name), v: s.values });
    else bad.push(s);
  }
  const data = labels.map((x, i) => Object.fromEntries([['x', x], ...good.map((s, j) => [`s${j}`, s.v[i]])]));
  const fc = Number.isFinite(p.forecast) ? p.forecast : Infinity;
  const tones = Array.isArray(p.tones) ? p.tones : [];
  const target = Number.isFinite(p.target) ? <ReferenceLine y={p.target} stroke={INK} strokeDasharray="4 3" ifOverflow="extendDomain" /> : null;
  const axes = [<CartesianGrid key="g" vertical={false} stroke={LINE} />, <XAxis key="x" dataKey="x" {...AXIS} />, <YAxis key="y" width={36} axisLine={false} {...AXIS} />, <Tooltip key="t" {...TIP} />];
  return (
    <figure className="ou-pd-chart">
      <Caption p={p} />
      {good.length ? (
        <ResponsiveContainer width="100%" height={180}>
          {p.kind === 'bar' ? (
            <BarChart data={data} margin={MARGIN}>
              {axes}
              {good.map((s, j) => (
                <Bar key={j} dataKey={`s${j}`} name={s.name} fill={SERIES[j]} isAnimationActive={false} maxBarSize={40}>
                  {data.map((_, i) => <Cell key={i} fill={i >= fc ? MUTE : pick(BAR_TONE, tones[i], SERIES[j])} fillOpacity={i >= fc ? 0.45 : 1} />)}
                </Bar>
              ))}
              {target}
            </BarChart>
          ) : (
            <LineChart data={data} margin={MARGIN}>
              {axes}
              {good.map((s, j) => <Line key={j} dataKey={`s${j}`} name={s.name} stroke={SERIES[j]} strokeWidth={2} dot={false} isAnimationActive={false} />)}
              {target}
            </LineChart>
          )}
        </ResponsiveContainer>
      ) : null}
      {good.length > 1 ? <Key items={good.map((s, j) => [s.name, SERIES[j]])} /> : null}
      {bad.map((s, i) => <Plain key={i} f={fallback(s, 'bad series')} />)}
    </figure>
  );
}

function spark({ p }) {
  const v = p.values.filter(Number.isFinite).slice(-60);
  if (v.length < 2) return <Plain f={fallback(p, 'spark needs two or more numbers')} />;
  return (
    <div className="ou-pd-spark">
      {isStr(p.label) ? <Text color="secondary" size="sm">{S(p.label)}</Text> : null}
      <LineChart width={120} height={24} data={v.map((y) => ({ y }))} margin={{ top: 2, right: 1, bottom: 2, left: 1 }}>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Line dataKey="y" stroke={MUTE} strokeWidth={1.4} dot={false} isAnimationActive={false} />
      </LineChart>
      {isStr(p.value) ? <Text size="sm">{S(p.value)}</Text> : null}
    </div>
  );
}

function tracker({ p }) {
  const cells = p.cells.slice(-60);
  return (
    <div className="ou-pd-track">
      <div className="ou-pd-row">
        {isStr(p.label) ? <Text color="secondary" size="sm">{S(p.label)}</Text> : null}
        <span className="ou-pd-cells" role="img" aria-label={cells.filter((c) => typeof c === 'string').join(', ')}>
          {cells.map((c, i) => (typeof c === 'string' ? <i key={i} className={pick(CELL, c, CELL.none)} /> : null))}
        </span>
      </div>
      {cells.map((c, i) => (typeof c === 'string' ? null : <Plain key={i} f={fallback(c, `bad cell ${i + 1}`)} />))}
    </div>
  );
}

/** Part components for batch D: { name: ({ p, Part }) => element }. */
export default { chart, spark, tracker };
