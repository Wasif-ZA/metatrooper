import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Step, Stepper } from '@astryxdesign/core/Stepper';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TreeList } from '@astryxdesign/core/TreeList';
import { VStack } from '@astryxdesign/core/VStack';
import { MAX_ROWS } from './check.js';
import { Plain } from './Draw.jsx';
import './parts-a.css';

const isStr = (v) => typeof v === 'string' || typeof v === 'number';
const need = (v) => { if (!isStr(v)) throw new Error('bad'); return String(v); };
const maybe = (v) => (v == null ? undefined : need(v));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const obj = (v) => { if (!isObj(v)) throw new Error('bad'); return v; };
const textOf = (x) => { try { const s = String(JSON.stringify(x, null, 1)); return s.length > 400 ? `${s.slice(0, 400)} ...` : s; } catch { return '(unreadable input)'; } };
const bad = (name, x, i) => <Plain key={`bad${i}`} f={{ name, why: `bad item ${i + 1}`, text: textOf(x) }} />;
const noop = () => {};

/** Maps each item through f; an item f throws on becomes a Plain box, kept apart so astryx containers only get good items. */
function split(a, name, f) {
  const good = [];
  const out = [];
  a.slice(0, MAX_ROWS).forEach((x, i) => { try { good.push(f(x, i)); } catch { out.push(bad(name, x, i)); } });
  return [good, out];
}

const Kids = ({ a, Part }) => <VStack gap={3}>{a.map((c, i) => <Part key={i} p={c} />)}</VStack>;
const Aside = ({ t }) => (t == null ? null : <Text color="secondary" size="sm">{String(t)}</Text>);

const BAR = { need: 'warning', fail: 'error', lead: 'success' };
const DOT = { ok: 'success', fail: 'error', warn: 'warning', run: 'accent', none: 'neutral' };
const STEP = { done: 'success', fail: 'error' };
const CALL = { info: 'info', ok: 'success', error: 'error' };

const clampPct = (n) => Math.max(0, Math.min(100, n));

function Rows({ p }) {
  return (
    <List hasDividers>
      {p.map((r) => <ListItem key={r.key} label={r.label} description={r.description} startContent={r.start} endContent={r.end} isSelected={r.on} />)}
    </List>
  );
}

function Tree({ p }) {
  let n = 0;
  const outs = [];
  const walk = (ns, d, path) => {
    if (d > 6) return [];
    const [good, out] = split(ns, 'tree', (x, i) => {
      if (++n > MAX_ROWS) return null;
      const label = need(obj(x).label);
      const right = maybe(x.right);
      const state = x.children && !x.state ? null : DOT[x.state] ? x.state : 'none';
      return {
        id: `${path}.${i}`,
        label,
        isExpanded: true,
        startContent: state ? <StatusDot variant={DOT[state]} label={state} /> : undefined,
        endContent: right == null ? undefined : <Aside t={right} />,
        children: Array.isArray(x.children) ? walk(x.children, d + 1, `${path}.${i}`) : undefined,
      };
    });
    outs.push(...out);
    return good.filter(Boolean);
  };
  const items = walk(p.nodes, 0, 't');
  return <div className="ou-pa-col">{items.length ? <TreeList items={items} density="compact" /> : null}{outs}</div>;
}

function Side({ s }) {
  return (
    <Card padding={3}>
      <VStack gap={1}>
        <Heading level={4}>{need(s.title)}</Heading>
        {s.sub == null ? null : <Aside t={need(s.sub)} />}
        {(Array.isArray(s.lines) ? s.lines.slice(0, MAX_ROWS) : []).map((l, i) => <Text key={i} size="sm">{need(l)}</Text>)}
      </VStack>
    </Card>
  );
}

const side = (s, name) => { try { obj(s); need(s.title); (s.lines || []).forEach(need); maybe(s.sub); return <Side s={s} />; } catch { return bad(name, s, 0); } };

export default {
  bar: ({ p }) => (
    <div className="ou-pa-col">
      <ProgressBar label={String(p.label)} value={clampPct(p.pct)} max={100} hasValueLabel formatValueLabel={() => String(p.value)} variant={BAR[p.tone] || 'accent'} />
      <Aside t={p.note} />
    </div>
  ),

  matrix: ({ p }) => {
    const cols = p.cols.slice(0, 20).map((c) => (isStr(c) ? String(c) : '?'));
    const [rows, outs] = split(p.rows, 'matrix', (r, i) => ({ id: String(i), label: need(obj(r).label), cells: Array.isArray(r.cells) ? r.cells : [] }));
    const columns = [
      { key: 'label', header: '', renderCell: (r) => r.label },
      ...cols.map((h, j) => ({ key: `c${j}`, header: h, renderCell: (r) => { const s = DOT[r.cells[j]] ? r.cells[j] : 'none'; return <StatusDot variant={DOT[s]} label={s} />; } })),
    ];
    return <div className="ou-pa-col"><Table data={rows} columns={columns} idKey="id" />{outs}</div>;
  },

  compare: ({ p }) => (
    <div className="ou-pa-compare">
      {side(p.left, 'compare left')}
      <Text weight="bold">{p.delta == null ? '→' : String(p.delta)}</Text>
      {side(p.right, 'compare right')}
    </div>
  ),

  cards: ({ p }) => {
    const [cards, outs] = split(p.items, 'cards', (c, i) => {
      obj(c);
      const facts = (Array.isArray(c.facts) ? c.facts : []).slice(0, 12).map(need);
      const lines = (Array.isArray(c.lines) ? c.lines : []).slice(0, 12).map(need);
      const note = maybe(c.note);
      return (
        <Card key={i} padding={3}>
          <VStack gap={2}>
            {lines.length ? <Card variant="muted" padding={2}><VStack gap={1}>{lines.map((l, k) => <Text key={k} size="sm" color="secondary">{l}</Text>)}</VStack></Card> : null}
            <HStack gap={2} vAlign="center"><Heading level={4}>{need(c.title)}</Heading>{i === p.pick ? <Badge variant="info" label="Picked" /> : null}</HStack>
            {facts.length ? <HStack gap={1} wrap="wrap">{facts.map((f, k) => <Badge key={k} label={f} />)}</HStack> : null}
            <Aside t={note} />
          </VStack>
        </Card>
      );
    });
    return <div className="ou-pa-col"><Grid columns={{ minWidth: 180, max: 4 }} gap={3}>{cards}</Grid>{outs}</div>;
  },

  kv: ({ p }) => {
    const [rows, outs] = split(p.rows, 'kv', (r, i) => { if (!Array.isArray(r)) throw new Error('bad'); return <MetadataListItem key={i} label={need(r[0])}>{need(r[1])}</MetadataListItem>; });
    return <div className="ou-pa-col">{rows.length ? <MetadataList>{rows}</MetadataList> : null}{outs}</div>;
  },

  list: ({ p }) => {
    const [groups, outs] = split(p.groups, 'list', (g, gi) => {
      obj(g);
      const [rows, rowOuts] = split(Array.isArray(g.rows) ? g.rows : [], 'list row', (r, i) => {
        obj(r);
        const right = maybe(r.right);
        const agent = maybe(r.agent);
        return {
          key: i,
          label: need(r.name),
          description: maybe(r.dir),
          start: r.icon == null ? undefined : <Badge label={need(r.icon)} />,
          end: right || agent ? <HStack gap={2} vAlign="center">{agent ? <Badge label={agent} /> : null}<Aside t={right} /></HStack> : undefined,
          on: r.cur === true,
        };
      });
      return (
        <div key={gi} className="ou-pa-col">
          <div className="ou-pa-head"><Text type="label">{need(g.label)}</Text><Aside t={maybe(g.aside)} /></div>
          {rows.length ? <Rows p={rows} /> : null}
          {rowOuts}
        </div>
      );
    });
    const keys = Array.isArray(p.keys) ? p.keys.slice(0, 12).filter(isStr).map(String) : [];
    return (
      <div className="ou-pa-col">
        {p.search == null ? null : <TextInput label="Search" isLabelHidden value="" placeholder={String(p.search)} isReadOnly onChange={noop} />}
        {groups}
        {outs}
        {keys.length ? <HStack gap={3}>{keys.map((k, i) => <Aside key={i} t={k} />)}</HStack> : null}
      </div>
    );
  },

  queue: ({ p }) => {
    const [rows, outs] = split(p.items, 'queue', (q, i) => {
      obj(q);
      const tag = maybe(q.tag);
      const acts = Array.isArray(q.actions) ? q.actions.slice(0, 6).map((a) => ({ label: need(obj(a).label), primary: a.primary === true })) : [];
      return {
        key: i,
        label: need(q.title),
        description: maybe(q.sub),
        start: q.flag === true ? <StatusDot variant="error" label="flagged" /> : undefined,
        end: tag || acts.length ? <HStack gap={2} vAlign="center">{tag ? <Badge label={tag} /> : null}{acts.map((a, k) => <Button key={k} size="sm" label={a.label} variant={a.primary ? 'primary' : 'secondary'} />)}</HStack> : undefined,
        on: i === p.selected,
      };
    });
    return <div className="ou-pa-col">{rows.length ? <Rows p={rows} /> : null}{outs}</div>;
  },

  steps: ({ p }) => {
    const [steps, outs] = split(p.steps, 'steps', (s, i) => ({ i, title: need(obj(s).title), sub: maybe(s.sub), value: maybe(s.value), state: ['done', 'cur', 'todo', 'fail'].includes(s.state) ? s.state : 'todo' }));
    const cur = steps.findIndex((s) => s.state === 'cur');
    const firstOpen = steps.findIndex((s) => s.state !== 'done');
    const active = cur >= 0 ? cur : firstOpen >= 0 ? firstOpen : steps.length;
    return (
      <div className="ou-pa-col">
        {steps.length ? (
          <Stepper label="Steps" orientation="vertical" activeStep={active}>
            {steps.map((s, k) => <Step key={k} step={k} label={s.title} description={s.sub} status={STEP[s.state]} endContent={s.value ? <Aside t={s.value} /> : undefined} />)}
          </Stepper>
        ) : null}
        {outs}
      </div>
    );
  },

  tree: Tree,

  empty: ({ p }) => <EmptyState title={String(p.title)} description={p.hint == null ? undefined : String(p.hint)} />,

  callout: ({ p }) => (
    <Banner
      status={CALL[p.tone] || 'info'}
      title={p.title == null ? String(p.text) : String(p.title)}
      description={p.title == null ? undefined : String(p.text)}
      collapsible={false}
    />
  ),

  // These four expect check.js to have built their child slots into checked parts; they stay out of the names file until it does.
  columns: ({ p, Part }) => (
    <Grid columns={Math.max(1, Math.min(6, p.children.length))} gap={4} align="start">
      {p.children.slice(0, 6).map((c, i) => <Kids key={i} a={Array.isArray(c) ? c : [c]} Part={Part} />)}
    </Grid>
  ),

  grid: ({ p, Part }) => (
    <Grid columns={Math.max(1, Math.min(6, Math.round(p.cols ?? 3)))} gap={3}>
      {p.children.map((c, i) => <Part key={i} p={c} />)}
    </Grid>
  ),

  fold: ({ p, Part }) => (
    <Collapsible trigger={<HStack gap={2} vAlign="center"><Text weight="bold">{String(p.title)}</Text><Aside t={p.aside} /></HStack>} defaultIsOpen={p.open === true}>
      <Kids a={p.children} Part={Part} />
    </Collapsible>
  ),

  tabs: ({ p, Part }) => {
    const [tabs, outs] = split(p.tabs, 'tabs', (t, i) => ({ i, label: need(obj(t).label), count: maybe(t.count), children: Array.isArray(t.children) ? t.children : [] }));
    const on = tabs.find((t) => t.i === (p.active ?? 0)) || tabs[0];
    return (
      <div className="ou-pa-col">
        {tabs.length ? (
          <TabList value={String(on.i)} onChange={noop} hasDivider>
            {tabs.map((t) => <Tab key={t.i} value={String(t.i)} label={t.label} endContent={t.count ? <Badge label={t.count} /> : undefined} />)}
          </TabList>
        ) : null}
        {outs}
        {on ? <Kids a={on.children} Part={Part} /> : null}
      </div>
    );
  },
};
