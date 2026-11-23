import { Component, createContext, useContext, useRef, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { ButtonGroup } from '@astryxdesign/core/ButtonGroup';
import { Heading } from '@astryxdesign/core/Heading';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { expand, isFallback } from './check.js';
import PA from './parts-a.jsx';
import PB from './parts-b.jsx';
import PC from './parts-c.jsx';
import PD from './parts-d.jsx';
import PE from './parts-e.jsx';
import './kit.css';

const MORE = { ...PA, ...PB, ...PC, ...PD, ...PE };

const TONE = { plain: 'primary', mute: 'secondary', ok: 'accent', error: 'primary' };
const LEVEL = { h1: 1, h2: 2 };

export function Plain({ f }) {
  return (
    <div className="ou-drawn-plain" role="note">
      <Text type="label">{f.name}</Text>
      <Text color="secondary" size="sm">{f.why}</Text>
      <pre>{f.text}</pre>
    </div>
  );
}

class Guard extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Plain f={{ name: this.props.name, why: 'could not draw', text: '' }} /> : this.props.children; }
}

const Form = createContext(null);
const EMPTY = (v) => v === '' || v == null || v === false;

/** A control's value on this surface: kept under `key` for the next event's context; `need` marks it required. */
export function useValue(key, initial, need) {
  const f = useContext(Form);
  const [v, set] = useState(initial);
  if (f) { f.vals[key] = v; if (need) f.need.add(key); }
  return [v, set, Boolean(f?.missing.includes(key) && EMPTY(v))];
}

/** Sends an event name, with every control value on the surface as context, to the agent that drew it. */
export const useEmit = () => useContext(Form)?.emit ?? (() => {});

/** One drawn button; a click sends its `event`, else its label. */
export function Act({ a, size }) {
  const emit = useEmit();
  const ev = a.event != null && (typeof a.event === 'string' || typeof a.event === 'number') ? a.event : a.label;
  return <Button size={size} label={String(a.label)} variant={a.primary === true ? 'primary' : 'secondary'} onClick={() => emit(ev)} />;
}

const Cell = ({ v }) => (typeof v === 'string' ? v : <Part p={v} />);

function Grid({ p }) {
  const columns = p.cols.map((h, j) => ({ key: `c${j}`, header: h, renderCell: (r) => <Cell v={r.cells[j]} /> }));
  const data = p.rows.map((cells, i) => ({ id: String(i), cells: isFallback(cells) ? [] : cells, bad: isFallback(cells) ? cells : null }));
  return (
    <div className="ou-drawn-table">
      <Table data={data.filter((r) => !r.bad)} columns={columns} idKey="id" hasHover />
      {data.filter((r) => r.bad).map((r) => <Plain key={r.id} f={r.bad} />)}
      {p.foot ? <Text color="secondary" size="sm">{String(p.foot)}</Text> : null}
      {p.more ? <Text color="secondary" size="sm">{`${p.more} more rows not drawn`}</Text> : null}
    </div>
  );
}

export function Part({ p }) {
  if (isFallback(p)) return <Plain f={p} />;
  switch (p.type) {
    case 'page': return <VStack gap={4}>{p.children.map((c, i) => <Part key={i} p={c} />)}</VStack>;
    case 'section':
      return (
        <section className="ou-drawn-section">
          <div className="ou-drawn-sechead"><Heading level={3}>{String(p.label)}</Heading>{p.aside ? <Text color="secondary" size="sm">{String(p.aside)}</Text> : null}</div>
          <VStack gap={3}>{p.children.map((c, i) => <Part key={i} p={c} />)}</VStack>
        </section>
      );
    case 'header':
      return (
        <div className="ou-drawn-header">
          <Heading level={p.big ? 1 : 2}>{String(p.title)}</Heading>
          {p.sub ? <Text color="secondary">{String(p.sub)}</Text> : null}
          {p.tabs ? <div className="ou-drawn-tabs">{p.tabs.map((t, i) => <Badge key={i} variant={i ? 'neutral' : 'info'} label={t} />)}</div> : null}
        </div>
      );
    case 'text': {
      const level = LEVEL[p.size];
      if (level) return <Heading level={level}>{String(p.text)}</Heading>;
      return <Text color={TONE[p.tone] || 'primary'} size={p.size === 'small' ? 'sm' : 'base'} className={p.tone === 'ok' || p.tone === 'error' ? `ou-drawn-${p.tone}` : undefined}>{String(p.text)}</Text>;
    }
    case 'table': return <Grid p={p} />;
    case 'buttons':
      return (
        <ButtonGroup label="Actions">
          {p.actions.map((a, i) => (isFallback(a) ? <Plain key={i} f={a} /> : <Act key={i} a={a} />))}
        </ButtonGroup>
      );
    default: {
      const X = MORE[p.type];
      return X ? <Guard name={p.type}><X p={p} Part={Part} /></Guard> : <Plain f={{ name: String(p.type), why: 'not drawn yet', text: '' }} />;
    }
  }
}

/** Draws an agent's spec from the catalogue only; every part is checked before it draws, and a bad one becomes a text box. */
export function Drawn({ spec, onEvent }) {
  const { root } = expand(spec);
  const [missing, setMissing] = useState([]);
  const vals = useRef({}).current;
  const need = useRef(new Set()).current;
  need.clear();
  const emit = (event, set = {}) => {
    Object.assign(vals, set);
    const gap = [...need].filter((k) => EMPTY(vals[k]));
    setMissing(gap);
    if (!gap.length && onEvent) onEvent({ event: String(event), context: Object.fromEntries(Object.entries(vals).filter(([, x]) => x != null).slice(0, 50).map(([k, x]) => [k.slice(0, 80), x])) });
  };
  return <div className="ou-drawn"><Form.Provider value={{ vals, need, missing, emit }}><Guard name="screen"><Part p={root} /></Guard></Form.Provider></div>;
}

